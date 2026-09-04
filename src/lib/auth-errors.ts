// better-auth 错误码 → 中文提示（T05）。未知错误回退到原始 message。

interface AuthError {
  code?: string | null;
  message?: string | null;
}

const messages: Record<string, string> = {
  USER_ALREADY_EXISTS: "该邮箱已注册",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "该邮箱已注册",
  // 登录失败统一口径，不区分「账号不存在」与「密码错误」
  INVALID_EMAIL_OR_PASSWORD: "邮箱或密码错误",
  USER_NOT_FOUND: "邮箱或密码错误",
  INVALID_PASSWORD: "邮箱或密码错误",
  INVALID_EMAIL: "邮箱格式不正确",
  PASSWORD_TOO_SHORT: "密码至少 8 位",
  PASSWORD_TOO_LONG: "密码过长",
};

export function authErrorMessage(error: AuthError | null | undefined): string {
  if (!error) return "请求失败，请重试";
  return (error.code && messages[error.code]) || error.message || "请求失败，请重试";
}
