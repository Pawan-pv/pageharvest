export interface ShippedPackage {
  name: string;
  version: string;
  license: string;
  homepage: string;
  text: string;
}

export const NOTICES_PATH: string;
export function shippedPackages(): ShippedPackage[];
export function buildNotices(): string;
