# 首次使用导览

调研参考（2026-10-04）：

- [Atlassian Spotlight](https://atlassian.design/components/spotlight/code)：聚焦一个真实控件，提供前进、返回和关闭。
- [VSCode 工作区介绍](https://code.visualstudio.com/docs/getstarted/userinterface)：按活动栏、文件区、编辑区、辅助栏和面板逐区介绍。
- [Notion 入门帮助](https://www.notion.com/help/category/new-to-notion)：从首个实际任务开始，帮助内容保留为可重复查阅的入口。

Liteasy 将这些思路组合成 9 步导览，不引入另一套 UI 框架。首次在空白工作区显示可跳过的邀请；手册提供常驻重播按钮。用户启动后才恢复导览布局，保留所有文件标签、动态页面位置和草稿，展开四个主要面板，额外分栏暂时隐藏。不会导入文件、连接服务或调用模型。

`useOnboardingController` 负责布局和页面编排，`onboardingSteps` 维护说明与目标。目标使用 `data-tour-page` / `data-tour` 标识，避免依赖中文文案与 DOM 层级。浮层直接测量真实目标，不复制目标节点、不修改原控件层级。ResizeObserver、滚动和尺寸变化合并到动画帧，退出后释放观察器。暂时没有目标时退化成全屏遮罩与可继续的卡片。

Fluent Dialog 负责焦点圈定与 Esc；标题随步骤获得焦点，进度有可访问名称，方向键支持前后切换。手动前进是默认行为；自动播放需明确开启，失焦暂停，最终一步等待完成。`prefers-reduced-motion` 关闭移动、入场及倒计时动画。尺寸较小时卡片约束在视口内并可滚动。

本机只保存 `liteasy.onboarding.v1` 的已开始／跳过／完成状态，不重复弹出邀请，也不保存用户内容。新增普通步骤不要更换存储键；用户始终可从手册重播。文案或步骤变化时同步手册与浏览器回归。
