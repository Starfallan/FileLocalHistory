import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Utils } from './utils';

/**
 * 历史记录项对象
 */
export interface HistoryEntry {
    filePath: string;      // 原始文件路径
    historyFilePath: string;  // 历史记录文件路径
    timestamp: string;     // 时间戳
    label: string;         // 显示标签
    description: string;   // 描述
}

/**
 * 历史记录管理器
 */
export class HistoryManager {
    private historyBasePath: string;

    constructor(private context: vscode.ExtensionContext) {
        this.historyBasePath = Utils.getHistoryBasePath(context);
        this.ensureHistoryBaseDir();
    }

    /**
     * 确保历史记录根目录存在
     */
    private ensureHistoryBaseDir(): void {
        if (!fs.existsSync(this.historyBasePath)) {
            fs.mkdirSync(this.historyBasePath, { recursive: true });
        }
    }

    /**
     * 保存文件的历史记录
     */
    public async saveHistory(filePath: string): Promise<void> {
        try {
            // 检查文件是否存在
            if (!fs.existsSync(filePath)) {
                return;
            }

            // 检查是否应该排除该文件
            if (Utils.shouldExcludeFile(filePath)) {
                return;
            }

            // 获取文件内容
            const content = fs.readFileSync(filePath);
            
            // 获取历史记录目录
            const historyDir = Utils.getHistoryDirForFile(this.historyBasePath, filePath);
            
            // 生成历史记录文件名
            const historyFileName = Utils.getHistoryFileName(filePath);
            const historyFilePath = path.join(historyDir, historyFileName);
            
            // 保存历史记录
            fs.writeFileSync(historyFilePath, content);
            
            // 创建元数据文件存储原始路径
            const metaFilePath = historyFilePath + '.meta';
            fs.writeFileSync(metaFilePath, filePath);
            
            // 清理过期的历史记录
            await this.cleanupHistory(filePath);
        } catch (error) {
            console.error('保存历史记录失败:', error);
        }
    }

    /**
     * 获取指定文件的所有历史记录
     */
    public getHistoryEntriesForFile(filePath: string): HistoryEntry[] {
        try {
            const historyDir = Utils.getHistoryDirForFile(this.historyBasePath, filePath);
            
            if (!fs.existsSync(historyDir)) {
                return [];
            }
            
            const files = fs.readdirSync(historyDir)
                .filter(file => !file.endsWith('.meta'))
                .sort((a, b) => b.localeCompare(a)); // 按时间戳逆序排序
            
            const entries: HistoryEntry[] = [];
            for (const file of files) {
                const parseResult = Utils.parseHistoryFileName(file);
                if (!parseResult) continue;
                
                const { timestamp } = parseResult;
                const historyFilePath = path.join(historyDir, file);
                
                entries.push({
                    filePath,
                    historyFilePath,
                    timestamp,
                    label: Utils.formatTimestampForDisplay(timestamp),
                    description: path.basename(filePath)
                });
            }
            
            return entries;
        } catch (error) {
            console.error('获取历史记录失败:', error);
            return [];
        }
    }

    /**
     * 清理过期的历史记录
     */
    public async cleanupHistory(filePath?: string): Promise<void> {
        try {
            const config = vscode.workspace.getConfiguration('filelocalhistory');
            const maxAge = config.get<number>('maxAgeInDays', 7);
            const maxFiles = config.get<number>('maxHistoryFiles', 30);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - maxAge);
            
            // 如果指定了文件路径，只清理该文件的历史记录
            if (filePath) {
                await this.cleanupFileHistory(filePath, cutoffDate, maxFiles);
            } 
            // 否则清理所有历史记录
            else {
                if (!fs.existsSync(this.historyBasePath)) return;
                
                const directories = fs.readdirSync(this.historyBasePath);
                for (const dir of directories) {
                    const dirPath = path.join(this.historyBasePath, dir);
                    if (!fs.statSync(dirPath).isDirectory()) continue;
                    
                    const metaFiles = fs.readdirSync(dirPath)
                        .filter(file => file.endsWith('.meta'));
                    
                    // 遍历元数据文件，获取原始文件路径
                    for (const metaFile of metaFiles) {
                        try {
                            const metaFilePath = path.join(dirPath, metaFile);
                            const originalPath = fs.readFileSync(metaFilePath, 'utf8');
                            await this.cleanupFileHistory(originalPath, cutoffDate, maxFiles);
                            break; // 只需要处理一个元数据文件即可
                        } catch (e) {
                            continue;
                        }
                    }
                }
            }
        } catch (error) {
            console.error('清理历史记录失败:', error);
        }
    }

    /**
     * 清理指定文件的历史记录
     */
    private async cleanupFileHistory(filePath: string, cutoffDate: Date, maxFiles: number): Promise<void> {
        const entries = this.getHistoryEntriesForFile(filePath);
        
        // 超过最大文件数量的部分
        if (entries.length > maxFiles) {
            const entriesToRemove = entries.slice(maxFiles);
            for (const entry of entriesToRemove) {
                try {
                    fs.unlinkSync(entry.historyFilePath);
                    fs.unlinkSync(entry.historyFilePath + '.meta');
                } catch (e) {
                    // 忽略删除失败的错误
                }
            }
        }
        
        // 超过最大天数的部分
        for (const entry of entries) {
            try {
                const { timestamp } = entry;
                const [datePart, timePart] = timestamp.split('_');
                const [year, month, day] = datePart.split('-').map(n => parseInt(n, 10));
                const [hour, minute, second] = timePart.split('-').map(n => parseInt(n, 10));
                
                const date = new Date(year, month - 1, day, hour, minute, second);
                
                if (date < cutoffDate) {
                    fs.unlinkSync(entry.historyFilePath);
                    fs.unlinkSync(entry.historyFilePath + '.meta');
                }
            } catch (e) {
                // 忽略删除失败的错误
            }
        }
    }

    /**
     * 获取历史记录文件的内容
     */
    public getHistoryFileContent(historyFilePath: string): Buffer | null {
        try {
            return fs.readFileSync(historyFilePath);
        } catch (error) {
            console.error('读取历史记录内容失败:', error);
            return null;
        }
    }    /**
     * 获取整个项目的历史记录
     */
    public getAllHistoryEntries(): HistoryEntry[] {
        try {
            if (!fs.existsSync(this.historyBasePath)) {
                return [];
            }
            
            const allEntries: HistoryEntry[] = [];
            const directories = fs.readdirSync(this.historyBasePath);
            
            for (const dir of directories) {
                const dirPath = path.join(this.historyBasePath, dir);
                if (!fs.statSync(dirPath).isDirectory()) continue;
                
                // 获取元数据文件
                const metaFiles = fs.readdirSync(dirPath)
                    .filter(file => file.endsWith('.meta'));
                
                if (metaFiles.length === 0) continue;
                
                // 读取所有元数据文件获取原始文件路径
                for (const metaFile of metaFiles) {
                    const metaFilePath = path.join(dirPath, metaFile);
                    try {
                        const originalFilePath = fs.readFileSync(metaFilePath, 'utf8');
                        
                        // 如果原始文件不存在，跳过
                        if (!fs.existsSync(originalFilePath)) continue;
                        
                        // 对应的历史文件
                        const historyFile = metaFile.replace('.meta', '');
                        const historyFilePath = path.join(dirPath, historyFile);
                        
                        if (!fs.existsSync(historyFilePath)) continue;
                        
                        const parseResult = Utils.parseHistoryFileName(historyFile);
                        if (!parseResult) continue;
                        
                        const { timestamp } = parseResult;
                        
                        allEntries.push({
                            filePath: originalFilePath,
                            historyFilePath,
                            timestamp,
                            label: Utils.formatTimestampForDisplay(timestamp),
                            description: this.getDisplayPath(originalFilePath)
                        });
                    } catch (e) {
                        continue;
                    }
                }
            }
            
            // 按时间戳逆序排序
            return allEntries.sort((a, b) => {
                const dateA = this.getDateFromTimestamp(a.timestamp);
                const dateB = this.getDateFromTimestamp(b.timestamp);
                return dateB.getTime() - dateA.getTime();
            });
        } catch (error) {
            console.error('获取全局历史记录失败:', error);
            return [];
        }
    }
      /**
     * 获取文件的相对路径或格式化路径，用于显示
     */
    private getDisplayPath(filePath: string): string {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return path.basename(filePath);
        }
        
        const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        if (filePath.startsWith(workspaceFolder)) {
            return filePath.substring(workspaceFolder.length + 1); // +1 移除开头的路径分隔符
        }
        
        return path.basename(filePath);
    }
    
    /**
     * 从时间戳字符串创建Date对象
     */
    private getDateFromTimestamp(timestamp: string): Date {
        try {
            const [datePart, timePart] = timestamp.split('_');
            const [year, month, day] = datePart.split('-').map(n => parseInt(n, 10));
            const [hour, minute, second] = timePart.split('-').map(n => parseInt(n, 10));
            
            return new Date(year, month - 1, day, hour, minute, second);
        } catch (e) {
            return new Date();
        }
    }
}