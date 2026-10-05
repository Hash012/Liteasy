# 桌面界面语言

设置 → 外观与阅读 → 应用界面 → 界面语言：跟随系统、简体中文、English。
界面选择保存在现有 `liteasy.view-settings.v1` 的 `view.language`；与
`assistant.language`、`import.ocr_language` 独立。新安装跟随系统，检测到旧偏好时保留中文。
系统语言取 WebView 的 `navigator.languages`，中文区域映射为简体中文，英文区域映射为英文；
不支持的系统语言回退英文。缺失译文始终回退中文。切换不刷新页面、不重建 App/编辑器，
不改写用户资料，不调用模型或在线翻译。存储失败时保留本次会话选择并显示提示。

## 新文案与翻译维护

**新增功能默认使用中文；只有用户明确要求时才更新其他语言。不要为了 CI 通过批量补译。**
已有词条用 `useUiTranslation().t`；新文案可直接带中文默认值，不要求修改语言包：

```tsx
const { tChinese } = useUiTranslation();
return <Button>{tChinese("notes.newAction", "整理笔记")}</Button>;
// 含参数：tChinese("notes.saved", "已保存 {{count}} 项", { count: 2 })
```

React 以文本节点渲染结果；不要将翻译送入 `dangerouslySetInnerHTML`。
组件（包括 memo 组件）必须订阅 `useUiTranslation`。非 React 调用方使用
`message` / `messageWithFallback`；模块级注册表用 getter 获取文案，避免切换后冻结旧语言。
既有状态、持久化键、协议值、路径、用户标题、论文正文、提示词和 AI 输出不翻译。

接入包的初始 273 个中英词条随本次功能引入。中文目录是参数类型的源，英文允许缺项；
校验已有翻译的参数/复数、空值、重复键及 HTML，不要求中英文数量一致。
只有授权更新中文目录时才运行 `node scripts/check-i18n.mjs --write-types` 并提交生成类型。
`i18n:check` 只检查，不翻译、不回写词条。`i18n:audit` 是只读候选清单，不是全产品翻译覆盖率。

## 本次覆盖

- 语言运行时、初始化、同源窗口同步、系统语言变化与持久化。
- 活动栏标签/提示，起始页，快捷操作及搜索。
- 设置页标题/分类/章节/搜索/注册表，外观与阅读控件、字体选择器。
- 日期/数字/相对时间/文件大小的格式化工具；未批量替换历史调用点。

文献库/阅读器/AI/账号/组织等业务页面、设置子面板、入门导览、帮助正文和插件文案
仍保留既有中文，后续按用户指定范围翻译。操作系统文件对话框和安装器语言不由前端控制。
本次不更新用户手册，不改变 AI 的生成语言。

## 验证入口

在桌面目录执行 `npm run test:i18n`、`npm run ci:smoke`、`npm run build`。
`src/tests/browser/uiLanguage.browser.spec.ts` 验证整应用草稿、PDF 页码保留、
系统语言、重新打开和英文窄栏布局。浏览器默认测试 locale 为 `zh-CN`；
英文场景显式使用 `en-GB`。Windows WebView、原生多窗口和真实系统语言变化需要另行原生验证。
