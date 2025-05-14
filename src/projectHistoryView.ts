import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { HistoryEntry, HistoryManager } from './historyManager';

/**
 * 项目历史记录树项
 */
class ProjectHistoryItem extends vscode.TreeItem {    constructor(
        public readonly entry: HistoryEntry,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        // 先调用父类构造函数 - 文件路径作为主标签
        super(entry.description, collapsibleState);
        
        // 时间作为描述部分
        this.description = entry.label;
        
        // 悬浮窗保持多行显示
        this.tooltip = `${entry.label}\n${entry.description}`;
        
        this.contextValue = 'projectHistoryItem';
        this.resourceUri = vscode.Uri.file(entry.filePath);
        
        // 添加命令处理
        this.command = {
            command: 'filelocalhistory.compareWithCurrent',
            title: '与当前版本比较',
            arguments: [entry]
        };
        
        // 设置图标
        this.iconPath = vscode.ThemeIcon.File;
    }
}

/**
 * 时间分组项
 */
class TimeGroupItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly entries: HistoryEntry[]
    ) {
        super(label, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'timeGroup';
        this.tooltip = label;
        this.iconPath = new vscode.ThemeIcon('history');
    }
}

/**
 * 项目历史记录树数据提供者
 */
export class ProjectHistoryViewProvider implements vscode.TreeDataProvider<ProjectHistoryItem | TimeGroupItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ProjectHistoryItem | TimeGroupItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
    
    private historyEntries: HistoryEntry[] = [];
    private filteredEntries: HistoryEntry[] = [];
    private filterPattern: string | undefined;
    
    constructor(private historyManager: HistoryManager) {
        this.refreshEntries();
    }
    
    /**
     * 刷新视图
     */
    refresh(): void {
        this.refreshEntries();
        this._onDidChangeTreeData.fire(undefined);
    }
    
    /**
     * 设置筛选条件
     */
    setFilter(pattern: string | undefined): void {
        this.filterPattern = pattern;
        this.applyFilter();
        this._onDidChangeTreeData.fire(undefined);
    }
    
    /**
     * 应用筛选条件
     */
    private applyFilter(): void {
        if (!this.filterPattern) {
            this.filteredEntries = [...this.historyEntries];
            return;
        }
        
        const lowerPattern = this.filterPattern.toLowerCase();
        this.filteredEntries = this.historyEntries.filter(entry => 
            entry.description.toLowerCase().includes(lowerPattern) ||
            path.basename(entry.filePath).toLowerCase().includes(lowerPattern)
        );
    }
    
    /**
     * 刷新历史记录条目
     */
    private refreshEntries(): void {
        this.historyEntries = this.historyManager.getAllHistoryEntries();
        this.applyFilter();
    }
    
    /**
     * 获取树项元素
     */
    getTreeItem(element: ProjectHistoryItem | TimeGroupItem): vscode.TreeItem {
        return element;
    }
    
    /**
     * 获取父树项，用于支持 reveal 方法
     */
    getParent(element: ProjectHistoryItem | TimeGroupItem): vscode.ProviderResult<TimeGroupItem> {
        if (element instanceof ProjectHistoryItem) {
            // 返回 item 所属的时间组
            for (const group of this.createTimeGroups()) {
                if (group.entries.some(entry => 
                    entry.historyFilePath === element.entry.historyFilePath)) {
                    return group;
                }
            }
        }
        
        // 根节点没有父节点
        return null;
    }
    
    /**
     * 获取子树项
     */
    getChildren(element?: ProjectHistoryItem | TimeGroupItem): Thenable<(ProjectHistoryItem | TimeGroupItem)[]> {
        if (this.filteredEntries.length === 0) {
            return Promise.resolve([]);
        }
        
        // 根节点，按时间块分组
        if (!element) {
            // 创建时间分组
            const timeGroups = this.createTimeGroups();
            return Promise.resolve(timeGroups);
        }
        
        // 时间组下的历史记录项
        if (element instanceof TimeGroupItem) {
            return Promise.resolve(
                element.entries
                    .sort((a, b) => {
                        // 先按时间戳降序排序
                        const timeCompare = b.timestamp.localeCompare(a.timestamp);
                        // 如果时间相同，则按文件路径排序
                        return timeCompare !== 0 ? timeCompare : a.description.localeCompare(b.description);
                    })
                    .map(entry => 
                        new ProjectHistoryItem(entry, vscode.TreeItemCollapsibleState.None)
                    )
            );
        }
        
        return Promise.resolve([]);
    }
      /**
     * 创建时间分组
     */
    private createTimeGroups(): TimeGroupItem[] {
        // 如果没有历史记录，显示提示信息
        if (this.filteredEntries.length === 0) {
            return [];
        }
        
        const timeGroups = new Map<string, HistoryEntry[]>();
        const now = new Date();
        
        // 当前小时
        const currentHour = new Date(now);
        currentHour.setMinutes(0, 0, 0);
        
        // 今天开始
        const today = new Date(now);
        today.setHours(0, 0, 0, 0);
        
        // 昨天开始
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        // 本周开始
        const thisWeekStart = new Date(today);
        thisWeekStart.setDate(thisWeekStart.getDate() - thisWeekStart.getDay());
        
        // 上周开始
        const lastWeekStart = new Date(thisWeekStart);
        lastWeekStart.setDate(lastWeekStart.getDate() - 7);
        
        // 本月开始
        const thisMonthStart = new Date(today);
        thisMonthStart.setDate(1);
          // 为每个历史记录条目分配时间组
        for (const entry of this.filteredEntries) {
            const entryDate = this.getDateFromTimestamp(entry.timestamp);
            
            let timeGroup: string;
            
            if (entryDate >= currentHour) {
                timeGroup = '过去一小时内';
            } else if (entryDate >= today) {
                timeGroup = '今天';
            } else if (entryDate >= yesterday) {
                timeGroup = '昨天';
            } else if (entryDate >= thisWeekStart) {
                timeGroup = '本周';
            } else if (entryDate >= lastWeekStart) {
                timeGroup = '上周';
            } else if (entryDate >= thisMonthStart) {
                timeGroup = '本月';
            } else {
                // 使用月份作为组名
                const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', 
                                    '七月', '八月', '九月', '十月', '十一月', '十二月'];
                timeGroup = `${entryDate.getFullYear()}年${monthNames[entryDate.getMonth()]}`;
            }
            
            const entries = timeGroups.get(timeGroup) || [];
            entries.push(entry);
            timeGroups.set(timeGroup, entries);
        }
        
        // 转换为树项，并确保按时间顺序排序
        const timeGroupOrder = [
            '过去一小时内', '今天', '昨天', '本周', '上周', '本月'
        ];
        
        const items: TimeGroupItem[] = [];
        
        // 先添加固定的时间组
        for (const groupName of timeGroupOrder) {
            const entries = timeGroups.get(groupName);
            if (entries && entries.length > 0) {
                // 标记该组的项目数量
                const groupLabel = `${groupName} (${entries.length})`;
                items.push(new TimeGroupItem(groupLabel, entries));
                timeGroups.delete(groupName);
            }
        }
        
        // 再添加按月份的组
        const monthGroups = Array.from(timeGroups.entries())
            .sort((a, b) => b[0].localeCompare(a[0])); // 月份按逆序排序
        
        for (const [groupName, entries] of monthGroups) {
            // 标记该组的项目数量
            const groupLabel = `${groupName} (${entries.length})`;
            items.push(new TimeGroupItem(groupLabel, entries));
        }
        
        return items;
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

/**
 * 项目历史记录视图管理器
 */
export class ProjectHistoryViewManager {
    private projectHistoryView: vscode.TreeView<ProjectHistoryItem | TimeGroupItem>;
    private projectHistoryViewProvider: ProjectHistoryViewProvider;
    
    constructor(private context: vscode.ExtensionContext, private historyManager: HistoryManager) {
        this.projectHistoryViewProvider = new ProjectHistoryViewProvider(historyManager);
        
        // 注册树视图
        this.projectHistoryView = vscode.window.createTreeView('filelocalhistoryProjectView', {
            treeDataProvider: this.projectHistoryViewProvider,
            showCollapseAll: true
        });
        
        // 添加到订阅列表
        context.subscriptions.push(this.projectHistoryView);
        
        // 注册命令
        this.registerCommands();
        
        // 初始时自动刷新项目历史视图
        this.projectHistoryViewProvider.refresh();
    }
    
    /**
     * 注册命令
     */
    private registerCommands(): void {
        // 显示项目历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.showProjectHistory', () => {
                this.showProjectHistoryView();
                this.projectHistoryViewProvider.refresh();
            })
        );
        
        // 刷新项目历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.refreshProjectHistory', () => {
                this.projectHistoryViewProvider.refresh();
            })
        );
        
        // 筛选项目历史记录
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.filterProjectHistory', async () => {
                const filterPattern = await vscode.window.showInputBox({
                    placeHolder: '输入文件名或路径进行筛选',
                    prompt: '留空将显示所有历史记录'
                });
                
                // filterPattern可能是undefined（用户取消）或空字符串（清除筛选）
                this.projectHistoryViewProvider.setFilter(filterPattern === '' ? undefined : filterPattern);
            })
        );
        
        // 打开文件
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.openFile', async (item: ProjectHistoryItem) => {
                const filePath = item.entry.filePath;
                if (fs.existsSync(filePath)) {
                    const document = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(document);
                } else {
                    vscode.window.showErrorMessage(`文件 ${filePath} 不存在`);
                }
            })
        );
        
        // 在资源管理器中显示
        this.context.subscriptions.push(
            vscode.commands.registerCommand('filelocalhistory.revealInExplorer', (item: ProjectHistoryItem) => {
                const filePath = item.entry.filePath;
                if (fs.existsSync(filePath)) {
                    // 使用VS Code API打开资源管理器并选中文件
                    vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(filePath));
                } else {
                    vscode.window.showErrorMessage(`文件 ${filePath} 不存在`);
                }
            })
        );
    }    /**
     * 显示项目历史记录视图
     */
    private showProjectHistoryView(): void {
        try {
            // 使用命令显示项目历史记录视图面板
            vscode.commands.executeCommand('workbench.view.extension.filelocalhistory-explorer');
        } catch (error) {
            console.error('显示项目历史记录视图失败:', error);
        }
    }
}
