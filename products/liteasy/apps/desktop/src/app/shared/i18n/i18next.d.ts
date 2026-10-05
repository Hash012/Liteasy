import "i18next";
import zhCN from "./locales/zh-CN.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    keySeparator: false;
    returnNull: false;
    enableSelector: false;
    resources: { translation: typeof zhCN };
  }
}
