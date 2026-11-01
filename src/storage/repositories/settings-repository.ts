import { PageHarvestDB, db as defaultDb, migrateStoredSettings } from '../db';
import { UserSettings } from '@/types/settings';
import { UserSettingsSchema } from '@/shared/contracts/settings';

export class SettingsRepository {
  private db: PageHarvestDB;

  constructor(db?: PageHarvestDB) {
    this.db = db || defaultDb;
  }

  /** Reads the settings, upgrading a row stored by an earlier version. */
  public async getSettings(): Promise<UserSettings> {
    const stored = await this.db.settings.get('current');
    if (!stored) {
      const defaults = UserSettingsSchema.parse({ id: 'current' });
      await this.db.settings.put(defaults);
      return defaults;
    }
    return migrateStoredSettings(stored);
  }

  /**
   * Validates and writes settings. Rejects on invalid values or a failed write;
   * the returned value is what was committed.
   */
  public async updateSettings(updates: Partial<UserSettings>): Promise<UserSettings> {
    const current = await this.getSettings();
    const updated = UserSettingsSchema.parse({
      ...current,
      ...updates,
      id: 'current',
      updatedAt: Date.now(),
    });
    await this.db.settings.put(updated);
    return updated;
  }

  public async resetSettings(): Promise<UserSettings> {
    const reset = UserSettingsSchema.parse({ id: 'current' });
    await this.db.settings.put(reset);
    return reset;
  }
}
