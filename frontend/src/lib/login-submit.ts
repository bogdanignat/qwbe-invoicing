export const submitLogin = async (
  formData: FormData,
  login: (token: string) => Promise<void>,
): Promise<void> => {
  const token = formData.get("token")
  if (typeof token === "string") await login(token)
}
