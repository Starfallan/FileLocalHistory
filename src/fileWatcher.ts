import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryManager } from './historyManager';
import { Utils } from './utils';

/**
 * 文件监视器，监控工作区文件的变化并保存历史记录
 */
export class FileWatcher {
    private watcher: vscode.FileSystemWatcher | undefined;
    private savingInProgress = false;
    private lastSaveTimeMap = new Map<string, number>();
    private readonly debounceTime = 1000; // 1秒的防抖时间

    constructor(private historyManager: HistoryManager) {
        this.setupFileWatcher();
    }

    /**
     * 设置文件监视器
     */
    private setupFileWatcher(): void {
        // 监视所有文件的保存事件
        vscode.workspace.onDidSaveTextDocument((document) => {
            this.handleFileSaved(document.fileName);
        });

        // 监视所有文件的更改事件
        this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
        this.watcher.onDidChange((uri) => {
            // 非文本文件的变更也通过这个事件处理
            if (!this.isTextDocument(uri.fsPath)) {
                this.handleFileSaved(uri.fsPath);
            }
        });

        // 处理初始打开的文档
        if (vscode.window.activeTextEditor) {
            const document = vscode.window.activeTextEditor.document;
            if (document && fs.existsSync(document.fileName)) {
                this.handleFileSaved(document.fileName);
            }
        }
    }

    /**
     * 处理文件保存事件
     */
    private handleFileSaved(filePath: string): void {
        if (this.savingInProgress) {
            return;
        }

        const config = vscode.workspace.getConfiguration('filelocalhistory');
        if (!config.get<boolean>('enabled', true)) {
            return;
        }

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return;
        }

        // 防抖处理，避免频繁保存同一文件
        const now = Date.now();
        const lastSaveTime = this.lastSaveTimeMap.get(filePath) || 0;
        if (now - lastSaveTime < this.debounceTime) {
            return;
        }

        this.lastSaveTimeMap.set(filePath, now);
        this.savingInProgress = true;

        this.historyManager.saveHistory(filePath)
            .finally(() => {
                this.savingInProgress = false;
            });
    }

    /**
     * 判断是否为文本文档
     */
    private isTextDocument(filePath: string): boolean {
        try {
            const editors = vscode.window.visibleTextEditors;
            for (const editor of editors) {
                if (editor.document.fileName === filePath) {
                    return true;
                }
            }
            
            // 检查扩展名，这不是完全可靠的方法，但可以作为辅助判断
            const ext = path.extname(filePath).toLowerCase();
            const textExtensions = [
                '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.html', '.css', '.scss',
                '.less', '.xml', '.yaml', '.yml', '.c', '.cpp', '.h', '.hpp', '.cs', '.java',
                '.py', '.rb', '.php', '.go', '.rs', '.swift', '.kt', '.kts', '.sh', '.bat'
            ];
            
            return textExtensions.includes(ext);
        } catch (error) {
            return false;
        }
    }

    /**
     * 清理资源
     */
    public dispose(): void {
        if (this.watcher) {
            this.watcher.dispose();
        }
    }
}