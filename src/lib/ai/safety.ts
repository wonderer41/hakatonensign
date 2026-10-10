export function isSafeExternalUrl(value: string | null | undefined): value is string {
  return /^https?:\/\//i.test(value ?? "");
}
