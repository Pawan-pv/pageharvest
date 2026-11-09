export const PRODUCTION_BUILD: string;
export const TEST_BUILD: string;
export const FIXTURE_HOSTS: string[];
export function prepareTestExtension(options?: { hosts?: string[]; source?: string; target?: string }): string;
