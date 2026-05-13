# Liteasy Phase 2 测试指南

这份文档面向没有开发经验的测试成员，目标是帮助你检查当前已经接入的 Phase 2 可见能力：

- 开发云账号连接
- 云端模型策略同步
- 基于当前选中文献集的关联推荐
- 从关联推荐拖入收藏并恢复

如果你还没有跑通过基础桌面原型，请先看：

- [phase1-test-guide.md](/home/octopus/Liteasy/docs/qa/phase1-test-guide.md)

## 1. 启动开发云服务

在仓库根目录执行：

```bash
node /home/octopus/Liteasy/services/dev-cloud/server.mjs
```

看到下面这行表示成功：

```text
Liteasy dev cloud listening on http://127.0.0.1:8787
```

## 2. 启动桌面端

另开一个终端，执行：

```bash
cd /home/octopus/Liteasy/desktop
source "$HOME/.cargo/env"
npm install
npm run tauri dev
```

## 3. 连接开发云策略端点

在右栏 `命令` 模式依次输入并发送：

```text
设置云代理端点为 http://127.0.0.1:8787
设置云端控制平面端点为 http://127.0.0.1:8787
同步云端策略
```

通过标准：

- 右栏出现 `同步状态：已同步`
- 能看到 `策略版本：dev-policy-v1`
- 能看到 `最近同步：2026-05-14T09:30:00Z`

## 4. 连接开发云账号

点击顶部右侧 `连接开发云账号`。

通过标准：

- 顶部显示 `Liteasy Researcher`
- 顶部显示 `researcher@liteasy.dev`
- 顶部显示会话有效期

## 5. 检查关联推荐

在左栏勾选 `BERT: Pre-training of Deep Bidirectional Transformers`，观察 `关联推荐` 区域。

通过标准：

- 会出现 `RoBERTa: A Robustly Optimized BERT Pretraining Approach`
- 会出现推荐来源，例如 `Semantic Scholar`
- 会出现 `关联：BERT: Pre-training of Deep Bidirectional Transformers`
- 会出现 `高关联`
- 会出现推荐理由说明

如果你取消勾选全部论文，推荐区域应回到“先勾选文献”的提示。

## 6. 检查推荐排序命令

先保持当前推荐列表可见，然后在右栏 `命令` 模式输入：

```text
按检索时间排序推荐
```

通过标准：

- 右栏消息历史出现 `已更新 推荐排序：按检索时间`
- 左栏推荐顺序发生变化
- 更晚检索到的推荐会排到前面

你也可以再输入：

```text
按关联度排序推荐
```

通过标准：

- 右栏消息历史出现 `已更新 推荐排序：按关联度`
- 左栏高关联条目会重新排到更前面

## 7. 检查拖拽到收藏

把 `关联推荐` 中的 `RoBERTa: A Robustly Optimized BERT Pretraining Approach` 拖到左栏 `收藏` 区域。

通过标准：

- `收藏` 区域会显示这篇文献
- 会显示来源，例如 `来源：Semantic Scholar`
- 推荐区刷新后，收藏区里的条目不会消失

## 8. 检查推荐开关

在右栏输入：

```text
关闭联网推荐
```

通过标准：

- 右栏消息历史出现“已更新 联网推荐：false”
- 左栏 `关联推荐` 区域提示联网推荐已关闭

然后再输入：

```text
开启联网推荐
```

通过标准：

- 右栏消息历史出现“已更新 联网推荐：true”
- 左栏在有选中文献集时重新显示推荐

## 9. 检查账号会话恢复

关闭桌面端窗口，再次执行：

```bash
cd /home/octopus/Liteasy/desktop
npm run tauri dev
```

通过标准：

- 顶部仍然显示刚才连接过的开发云账号
- 不需要再次点击登录按钮
- `收藏` 中刚才拖进去的收藏条目仍然存在

## 10. 当前阶段已知限制

- 开发云账号仍是演示账号，不是正式用户系统
- 推荐结果仍是开发演示数据，不是真实在线推荐
- 收藏目前只做了本地恢复，不参与云端同步
- 云端策略和推荐接口都还没有正式鉴权
