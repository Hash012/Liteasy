import { useState, type FormEvent } from "react";
import { developmentIdentity } from "./developmentIdentity";
import type { IdentitySession } from "./api";

export function DevelopmentAuthForm({
  onAuthenticated
}: {
  onAuthenticated: (session: IdentitySession) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus("");
    try {
      const session = mode === "login"
        ? await developmentIdentity.login(email, password)
        : await developmentIdentity.register(displayName, email, password);
      onAuthenticated(session);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "身份服务请求失败");
    } finally {
      setPending(false);
    }
  }

  return <><form onSubmit={submit}>{mode === "register" && <label>昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={80} autoComplete="name" /></label>}<label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><label>密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>{status && <p className="form-status">{status}</p>}<button className="primary-button" type="submit" disabled={pending}>{pending ? "正在验证..." : mode === "login" ? "登录" : "创建账号"}</button></form><button className="auth-switch" onClick={() => { setMode((value) => value === "login" ? "register" : "login"); setStatus(""); }}>{mode === "login" ? "没有账号？注册" : "已有账号？登录"}</button></>;
}
