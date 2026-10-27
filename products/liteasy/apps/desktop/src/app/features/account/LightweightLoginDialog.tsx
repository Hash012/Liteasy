import { useState } from "react";
import type { FormEvent } from "react";
import type {
  AccountLoginInput,
  AccountRegistrationInput
} from "./accountSessionClient";
import { isLoopbackAccountEndpoint } from "./desktopIdentityClient";
import { OpenRegular } from "@fluentui/react-icons";
import { Checkbox, Field, Input } from "@fluentui/react-components";
import { ActionButton as Button, InlineNotice, ModalSurface } from "../../shared/ui/productPrimitives";

type LightweightLoginDialogProps = {
  accountMessage?: string;
  accountPending?: boolean;
  controlPlaneEndpoint: string;
  onSkip: () => void;
  onSubmitAccountLogin: (login: AccountLoginInput) => void;
  onSubmitAccountRegistration: (registration: AccountRegistrationInput) => void;
  onSubmitSystemBrowserLogin: () => void;
  onToggleSuppressReminder: (checked: boolean) => void;
};

export function LightweightLoginDialog({
  accountMessage,
  accountPending = false,
  controlPlaneEndpoint,
  onSkip,
  onSubmitAccountLogin,
  onSubmitAccountRegistration,
  onSubmitSystemBrowserLogin,
  onToggleSuppressReminder
}: LightweightLoginDialogProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const showDevelopmentLogin = isLoopbackAccountEndpoint(controlPlaneEndpoint);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (accountPending) return;
    if (mode === "register") {
      onSubmitAccountRegistration({
        displayName: displayName.trim(),
        email: email.trim(),
        password
      });
      return;
    }

    onSubmitAccountLogin({
      email: email.trim(),
      password
    });
  }

  return <ModalSurface title="登录 LiteasyClaw" label="轻量登录面板" onClose={onSkip}
    actions={<Button appearance="subtle" onClick={onSkip}>跳过，进入本地阅读器</Button>}>
    <p>也可以暂不登录，在设置 → AI 接入中配置自己的 API key。</p>
    <p>{showDevelopmentLogin ? "当前连接本机开发账号服务。" : "登录在系统浏览器中完成，Liteasy 不会接触你的密码。"}</p>
    {!showDevelopmentLogin ? <Button appearance="primary" disabled={accountPending} icon={<OpenRegular />} onClick={onSubmitSystemBrowserLogin}>使用系统浏览器登录</Button> : <>
      <div aria-label="开发账号操作" className="product-action-chips" role="group">
        <Button aria-pressed={mode === "login"} appearance={mode === "login" ? "primary" : "secondary"} disabled={accountPending} onClick={() => setMode("login")}>已有账号登录</Button>
        <Button aria-pressed={mode === "register"} appearance={mode === "register" ? "primary" : "secondary"} disabled={accountPending} onClick={() => setMode("register")}>创建账号</Button>
      </div>
      <form onSubmit={handleSubmit}>
        {mode === "register" ? <Field label="昵称"><Input autoComplete="name" maxLength={80} required disabled={accountPending} value={displayName} onChange={(_, data) => setDisplayName(data.value)} /></Field> : null}
        <Field label="邮箱"><Input autoComplete="email" type="email" required disabled={accountPending} value={email} onChange={(_, data) => setEmail(data.value)} /></Field>
        <Field label={mode === "register" ? "密码或密码短语（至少 12 位）" : "密码"}>
          <Input autoComplete={mode === "register" ? "new-password" : "current-password"} type="password" maxLength={128} minLength={mode === "register" ? 12 : undefined} required disabled={accountPending} value={password} onChange={(_, data) => setPassword(data.value)} />
        </Field>
        <Button appearance="primary" disabled={accountPending} type="submit">{accountPending ? "请稍候…" : mode === "register" ? "注册并登录" : "登录"}</Button>
      </form>
    </>}
    {accountPending ? <InlineNotice intent="busy" message="正在等待登录结果…" /> : null}
    {accountMessage ? <InlineNotice message={accountMessage} /> : null}
    <Checkbox label="不再提醒" onChange={(_, data) => onToggleSuppressReminder(data.checked === true)} />
  </ModalSurface>;
}
