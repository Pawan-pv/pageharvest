import { PageHarvestDB, db as defaultDb } from '../db';
import { UserSettings, DEFAULT_USER_SETTINGS } from '@/types';

export class SettingsRepository {
  constructor(private db: PageHarvestDB = defaultDb) {}

  public async getSettings(): Promise<UserSettings> {
    const settings = await this.db.settings.get('current');
    if (!settings) {
      await this.db.settings.put(DEFAULT_USER_SETTINGS);
      return { ...DEFAULT_USER_SETTINGS };
    }
    return settings;
  }

  public async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const updated: UserSettings = {
      ...current,
      ...updates,
      id: 'current',
      updatedAt: Date.now(),
    };
    await this.db.settings.put(updated);
    return updated;
  }

  public async resetSettings(): Promise<UserSettings> {
    const reset: UserSettings = {
      ...DEFAULT_USER_SETTINGS,
      updatedAt: Date.now(),
    };
    await this.db.settings.put(reset);
    return reset;
  }
}
