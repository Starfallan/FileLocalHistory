import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { HistoryManager, HistoryEntry } from './historyManager';
import { Utils } from './utils';

/**
 * 历史记录树项
 */
class HistoryItem extends vscode.TreeItem {    constructor(
        public readonly entry: HistoryEntry,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        // 先调用父类构造函数
        super(path.basename(entry.filePath), collapsibleState);
        
        // 文件名作为主标签，时间作为描述
        // 使用文件图标
        this.iconPath = vscode.ThemeIcon.File;
        this.description = entry.label;
        
        // 悬浮窗保持多行显示
        this.tooltip = `${entry.label}\n${entry.description}`;
        this.contextValue = 'historyItem';
        
        // 如果是文件项，添加命令处理
        if (collapsibleState === vscode.TreeItemCollapsibleState.None) {
            this.command = {
                command: 'filelocalhistory.compareWithCurrent',
                title: '与当前版本比较',
                arguments: [entry]
            };
        }
    }
}

/**
 * 时间分组项
 */
class DateGroupItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly entries: HistoryEntry[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'dateGroup';
        this.tooltip = label;
    }
}

/**
 * 历史记录树数据提供者
 */
export class HistoryViewProvider implements vscode.TreeDataProvider<HistoryItem | DateGroupItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<HistoryItem | DateGroupItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private currentFilePath: string | undefined;
    private historyEntries: HistoryEntry[] = [];
    
    constructor(private historyManager: HistoryManager) {}
    
    /**
     * 刷新视图
     */
    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }
    
    /**
     * 设置当前文件路径并刷新视图
     */
    setFilePath(filePath: string | undefined): void {
        this.currentFilePath = filePath;
        
        if (filePath) {
            this.historyEntries = this.historyManager.getHistoryEntriesForFile(filePath);
        } else {
            this.historyEntries = [];
        }
        
        this.refresh();
    }
    
    /**
     * 获取树项元素
     */
    getTreeItem(element: HistoryItem | DateGroupItem): vscode.TreeItem {
        return element;
    }
    
    /**
     * 获取父树项，用于支持 reveal 方法
     */
    getParent(element: HistoryItem | DateGroupItem): vscode.ProviderResult<DateGroupItem> {
        if (element instanceof HistoryItem) {
            // 返回 item 所属的日期组
            for (const dateGroup of this.getDateGroups()) {
                if (dateGroup.entries.some(entry => 
                    entry.historyFilePath === element.entry.historyFilePath)) {
                    return dateGroup;
                }
            }
        }
        
        // 根节点没有父节点
        return null;
    }
    
    /**
     * 获取子树项
     */
    getChildren(element?: HistoryItem | DateGroupItem): Thenable<(HistoryItem | DateGroupItem)[]> {
        if (!this.currentFilePath || this.historyEntries.length === 0) {
            return Promise.resolve([]);
        }
        
        // 根节点，按日期分组
        if (!element) {
            const dateGroups = this.getDateGroups();
            return Promise.resolve(dateGroups);
        }
        
        // 日期组下的历史记录项
        if (element instanceof DateGroupItem) {
            return Promise.resolve(
                element.entries.map(entry => 
                    new HistoryItem(entry, vscode.TreeItemCollapsibleState.None)
                )
            );
        }
        
        return Promise.resolve([]);
    }
    
    /**
     * 获取所有日期组
     */
    private getDateGroups(): DateGroupItem[] {
        if (!this.currentFilePath || this.historyEntries.length === 0) {
            return [];
        }
        
        const dateGroups = new Map<string, HistoryEntry[]>();
        
        for (const entry of this.historyEntries) {
            const date = entry.timestamp.split('_')[0]; // 获取日期部分
            const entries = dateGroups.get(date) || [];
            entries.push(entry);
            dateGroups.set(date, entries);
        }
        
        // 转换为树项
        const items: DateGroupItem[] = [];
        for (const [date, entries] of dateGroups.entries()) {
            const dateLabel = this.getDateGroupLabel(date);
            items.push(new DateGroupItem(dateLabel, entries));
        }
        
        return items.sort((a, b) => b.label.localeCompare(a.label));
    }
    
    /**
     * 将日期字符串转换为友好的显示格式
     */
    private getDateGroupLabel(dateStr: string): string {
        try {
            const [year, month, day] = dateStr.split('-');
            const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            
            // 检查是否是今天
            const today = new Date();
            if (date.getDate() === today.getDate() && 
                date.getMonth() === today.getMonth() && 
                date.getFullYear() === today.getFullYear()) {
                return '今天';
            }
            
            // 检查是否是昨天
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (date.getDate() === yesterday.getDate() && 
                date.getMonth() === yesterday.getMonth() && 
                date.getFullYear() === yesterday.getFullYear()) {
                return '昨天';
            }
            
            // 其他日期显示完整格式
            return date.toLocaleDateString();
        } catch {
            return dateStr;
        }
    }
}

/**
 * 历史记录视图管理器
 */
export class HistoryViewManager {
    private historyView: vscode.TreeView<HistoryItem | DateGroupItem>;
    private historyViewProvider: HistoryViewProvider;
    
    constructor(private context: vscode.ExtensionContext, private historyManager: HistoryManager) {
        this.historyViewProvider = new HistoryViewProvider(historyManager);
        
        // 注册树视图
        this.historyView = vscode.window.createTreeView('filelocalhistoryView', {
            treeDataProvider: this.historyViewProvider,
            showCollapseAll: true
        });
        
        // 添加到订阅列表
        context.subscriptions.push(this.historyView);
        
        // 注册命令
        this.registerCommands();
        
        // 监听编辑器变化
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                this.historyViewProvider.setFilePath(editor.document.uri.fsPath);
            }
        });
    }
    
    /**
     * 注册命令
     */
    private registerCommands(): void {
        // 显示指定文件的历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.showHistoryForFile', (fileUri?: vscode.Uri) => {
                let filePath: string | undefined;
                
                if (fileUri) {
                    filePath = fileUri.fsPath;
                } else if (vscode.window.activeTextEditor) {
                    filePath = vscode.window.activeTextEditor.document.uri.fsPath;
                }
                
                if (!filePath) {
                    vscode.window.showErrorMessage('没有选择文件或打开的编辑器');
                    return;
                }
                
                // 显示历史视图
                this.showHistoryView();
                this.historyViewProvider.setFilePath(filePath);
            })
        );
        
        // 比较历史版本与当前版本
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.compareWithCurrent', async (entry: HistoryEntry) => {
                // 检查文件是否存在
                if (!fs.existsSync(entry.filePath)) {
                    vscode.window.showErrorMessage(`文件 ${entry.filePath} 不存在`);
                    return;
                }
                
                const originalUri = vscode.Uri.file(entry.filePath);
                const historyUri = vscode.Uri.file(entry.historyFilePath);
                
                // 打开差异比较
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    historyUri,
                    originalUri,
                    `${path.basename(entry.filePath)} (${entry.label}) ↔ 当前版本`
                );
            })
        );
        
        // 比较当前文件与前一个版本
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.compareWithPrevious', async () => {
                if (!vscode.window.activeTextEditor) {
                    vscode.window.showErrorMessage('没有打开的编辑器');
                    return;
                }
                
                const filePath = vscode.window.activeTextEditor.document.uri.fsPath;
                const entries = this.historyManager.getHistoryEntriesForFile(filePath);
                
                if (entries.length === 0) {
                    vscode.window.showInformationMessage('该文件没有历史版本');
                    return;
                }
                
                // 获取最新的历史版本
                const latestEntry = entries[0];
                
                const originalUri = vscode.Uri.file(filePath);
                const historyUri = vscode.Uri.file(latestEntry.historyFilePath);
                
                // 打开差异比较
                await vscode.commands.executeCommand(
                    'vscode.diff',
                    historyUri,
                    originalUri,
                    `${path.basename(filePath)} (${latestEntry.label}) ↔ 当前版本`
                );
            })
        );
        
        // 清理历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.purgeHistory', async () => {
                const options = ['全部历史记录', '仅当前文件'];
                
                const result = await vscode.window.showQuickPick(options, {
                    placeHolder: '请选择要清理的历史记录范围'
                });
                
                if (!result) {
                    return;
                }
                
                if (result === '全部历史记录') {
                    await this.historyManager.cleanupHistory();
                    vscode.window.showInformationMessage('已清理全部历史记录');
                } else {
                    if (!vscode.window.activeTextEditor) {
                        vscode.window.showErrorMessage('没有打开的编辑器');
                        return;
                    }
                    
                    const filePath = vscode.window.activeTextEditor.document.uri.fsPath;
                    await this.historyManager.cleanupHistory(filePath);
                    vscode.window.showInformationMessage(`已清理 ${path.basename(filePath)} 的历史记录`);
                }
                
                // 刷新视图
                this.historyViewProvider.refresh();
            })
        );
        
        // 显示历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.showHistory', () => {
                this.showHistoryView();
                
                if (vscode.window.activeTextEditor) {
                    this.historyViewProvider.setFilePath(vscode.window.activeTextEditor.document.uri.fsPath);
                }
            })
        );
    }    /**
     * 显示历史记录视图
     */
    private showHistoryView(): void {
        try {
            // 使用命令显示历史记录视图面板
            vscode.commands.executeCommand('workbench.view.extension.filelocalhistory-explorer');
        } catch (error) {
            console.error('显示历史记录视图失败:', error);
        }
    }
}