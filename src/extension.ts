// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { HistoryManager } from './historyManager';
import { FileWatcher } from './fileWatcher';
import { HistoryViewManager } from './historyView';
import { ProjectHistoryViewManager } from './projectHistoryView';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "filelocalhistory" is now active!');

	// 检查是否启用了功能
	const config = vscode.workspace.getConfiguration('filelocalhistory');
	const enabled = config.get<boolean>('enabled', true);

	if (!enabled) {
		console.log('FileLocalHistory 功能已禁用');
		return;
	}

	try {
		// 初始化历史记录管理器
		const historyManager = new HistoryManager(context);

		// 初始化文件监视器
		const fileWatcher = new FileWatcher(historyManager);
		context.subscriptions.push(fileWatcher);

		// 初始化历史记录视图
		const historyViewManager = new HistoryViewManager(context, historyManager);
		
		// 初始化项目历史记录视图
		const projectHistoryViewManager = new ProjectHistoryViewManager(context, historyManager);

		// 监听文件保存事件，更新项目历史视图
		const onFileSaved = vscode.workspace.onDidSaveTextDocument(() => {
			// 使用setTimeout避免频繁刷新
			setTimeout(() => {
				vscode.commands.executeCommand('filelocalhistory.refreshProjectHistory');
			}, 1000);
		});
		context.subscriptions.push(onFileSaved);

		// 注册状态栏按钮
		const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
		statusBarItem.text = "$(history) 本地历史";
		statusBarItem.tooltip = "查看本地历史记录";
		statusBarItem.command = "filelocalhistory.showQuickPick";
		statusBarItem.show();

		context.subscriptions.push(statusBarItem);
		
		// 注册快速选择命令
		context.subscriptions.push(
			vscode.commands.registerCommand('filelocalhistory.showQuickPick', async () => {
				const options = [
					{
						label: "$(file) 当前文件历史",
						description: "显示当前打开文件的历史记录",
						command: "filelocalhistory.showHistoryForFile"
					},
					{
						label: "$(history) 项目历史记录",
						description: "显示整个项目的历史记录",
						command: "filelocalhistory.showProjectHistory"
					}
				];
				
				const selected = await vscode.window.showQuickPick(options, {
					placeHolder: "选择要查看的历史记录"
				});
				
				if (selected) {
					vscode.commands.executeCommand(selected.command);
				}
			})
		);

		// 监听配置变更
		context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('filelocalhistory.enabled')) {
				const newConfig = vscode.workspace.getConfiguration('filelocalhistory');
				const isEnabled = newConfig.get<boolean>('enabled', true);

				if (isEnabled) {
					statusBarItem.show();
				} else {
					statusBarItem.hide();
				}
			}
		}));

		console.log('FileLocalHistory 初始化完成');
	} catch (error) {
		console.error('FileLocalHistory 初始化失败:', error);
		vscode.window.showErrorMessage('FileLocalHistory 初始化失败: ' + error);
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	console.log('FileLocalHistory 扩展已停用');
}
