export const PROVIDERS = ["github", "gitlab", "bitbucket"];

export function isProvider(value) {
  return PROVIDERS.includes(value);
}
