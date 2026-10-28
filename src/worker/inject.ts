const PROVIDER_MARKER = /^[ \t]*#\s*__PROXY_PROVIDERS__[ \t]*$/m;

export function hasProviderMarker(yaml: string): boolean {
  return PROVIDER_MARKER.test(yaml);
}

/** 整行替换标记，缩进由注入片段自己决定，避免用户改缩进后静默失效。 */
export function injectProviders(yaml: string, fragment: string): string {
  return yaml.replace(PROVIDER_MARKER, fragment);
}

export function injectProviderNames(yaml: string, names: string): string {
  return yaml.replaceAll('__PROVIDER_NAMES__', names);
}
