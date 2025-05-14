import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { minimatch } from 'minimatch';

export class Utils {
    /**
     * 获取历史记录的基本存储路径
     */
    public static getHistoryBasePath(context: vscode.ExtensionContext): string {
        const config = vscode.workspace.getConfiguration('filelocalhistory');
        const customPath = config.get<string>('historyPath', '');
        
        if (customPath && fs.existsSync(customPath)) {
            return customPath;
        }
        
        // 默认使用扩展的存储路径下的 history 目录
        return path.join(context.globalStorageUri.fsPath, 'history');
    }

    /**
     * 为文件生成基于路径的哈希值，用于区分不同项目和文件
     */
    public static getHashForFile(filePath: string): string {
        const hash = crypto.createHash('md5');
        hash.update(filePath);
        return hash.digest('hex');
    }

    /**
     * 根据文件路径生成历史记录目录
     */
    public static getHistoryDirForFile(basePath: string, filePath: string): string {
        const hash = this.getHashForFile(filePath);
        const dir = path.join(basePath, hash);
        
        // 确保目录存在
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        return dir;
    }

    /**
     * 获取格式化的时间戳
     */
    public static getFormattedTimestamp(): string {
        const now = new Date();
        return now.getFullYear() + 
               '-' + this.pad(now.getMonth() + 1) + 
               '-' + this.pad(now.getDate()) + 
               '_' + this.pad(now.getHours()) + 
               '-' + this.pad(now.getMinutes()) + 
               '-' + this.pad(now.getSeconds());
    }

    /**
     * 生成历史记录文件名
     */
    public static getHistoryFileName(filePath: string): string {
        const timestamp = this.getFormattedTimestamp();
        const fileName = path.basename(filePath);
        return `${timestamp}_${fileName}`;
    }

    /**
     * 从历史记录文件名中提取时间戳和原始文件名
     */
    public static parseHistoryFileName(historyFileName: string): { timestamp: string, originalFileName: string } | null {
        const match = historyFileName.match(/^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})_(.+)$/);
        if (!match) {
            return null;
        }
        
        return {
            timestamp: match[1],
            originalFileName: match[2]
        };
    }

    /**
     * 将数字转为两位数字符串
     */
    private static pad(n: number): string {
        return n < 10 ? '0' + n : n.toString();
    }    /**
     * 检查文件是否应该被排除在历史记录之外
     */
    public static shouldExcludeFile(filePath: string): boolean {
        const config = vscode.workspace.getConfiguration('filelocalhistory');
        const excludePatterns = config.get<string[]>('excludedFiles', []);
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        
        for (const pattern of excludePatterns) {
            // 常见的排除模式使用快速检测
            if (pattern === '**/.git/**' || pattern.includes('.git')) {
                if (filePath.includes('.git')) {
                    return true;
                }
            } else if (pattern === '**/node_modules/**' || pattern.includes('node_modules')) {
                if (filePath.includes('node_modules')) {
                    return true;
                }
            } else if (pattern === '**/.history/**' || pattern.includes('.history')) {
                if (filePath.includes('.history')) {
                    return true;
                }            } else {
                // 使用 minimatch 进行匹配
                const relativeFilePath = path.relative(workspacePath, filePath);
                if (minimatch(relativeFilePath, pattern)) {
                    return true;
                }
            }
        }
        
        return false;
    }

    /**
     * 格式化时间戳为可读字符串
     */
    public static formatTimestampForDisplay(timestamp: string): string {
        try {
            // 解析时间戳 "2023-01-15_14-30-25"
            const [datePart, timePart] = timestamp.split('_');
            const [year, month, day] = datePart.split('-').map(n => parseInt(n, 10));
            const [hour, minute, second] = timePart.split('-').map(n => parseInt(n, 10));
            
            const date = new Date(year, month - 1, day, hour, minute, second);
            return date.toLocaleString();
        } catch (error) {
            return timestamp; // 如果解析失败，返回原始时间戳
        }
    }
}