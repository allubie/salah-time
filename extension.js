import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const PRAYERS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];

const ICONS = {
    Fajr: 'weather-clear-night-symbolic',
    Sunrise: 'weather-clear-symbolic',
    Dhuhr: 'weather-clear-symbolic',
    Asr: 'weather-few-clouds-symbolic',
    Maghrib: 'weather-clear-night-symbolic',
    Isha: 'weather-clear-night-symbolic',
};

export default class PrayerTimesExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();
        this._currentDayIndex = -1;
        this._currentMonth = -1;
        this._currentYear = -1;
        
        // Setup top bar button
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);
        
        // Layout: Waqt + Countdown
        let box = new St.BoxLayout();
        
        this._waqtLabel = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'margin-right: 5px;'
        });
        box.add_child(this._waqtLabel);
        
        this._countdownLabel = new St.Label({
            text: '...',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._countdownLabel);
        this._indicator.add_child(box);
        
        // Location menu item opens preferences
        this._locationItem = new PopupMenu.PopupMenuItem('...');
        this._locationItem.label.get_clutter_text().set_use_markup(true);
        this._locationItem.connect('activate', () => {
            this.openPreferences();
        });
        this._indicator.menu.addMenuItem(this._locationItem);
        
        this._indicator.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Setup dropdown prayer list
        this._prayerItems = {};
        for (let prayer of PRAYERS) {
            let item = new PopupMenu.PopupBaseMenuItem({ reactive: false });
            
            let iconActor = new St.Icon({
                icon_name: ICONS[prayer],
                style_class: 'popup-menu-icon'
            });
            item.add_child(iconActor);

            let nameLabel = new St.Label({
                text: prayer,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'margin-left: 10px; margin-right: 10px;'
            });
            nameLabel.get_clutter_text().set_use_markup(true);
            item.add_child(nameLabel);

            let timeLabel = new St.Label({
                text: '--:--',
                y_align: Clutter.ActorAlign.CENTER
            });
            timeLabel.get_clutter_text().set_use_markup(true);
            item.add_child(timeLabel);

            this._prayerItems[prayer] = { item, nameLabel, timeLabel };
            this._indicator.menu.addMenuItem(item);
        }

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._httpSession = new Soup.Session();
        this._updateData();

        // Refresh data on location change, redraw menu on format change
        this._settingsChangedId = this._settings.connect('changed', (settings, key) => {
            if (key === 'time-format-12h') {
                this._updateMenu();
            } else if (key === 'city' || key === 'country' || key === 'auto-location') {
                this._updateData();
            }
        });

        // 1-minute tick to update countdown and handle day changes
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._checkDayRollover();
            this._updateCountdown();
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        
        this._httpSession = null;
        this._settings = null;
        this._timings = null;
        this._monthlyData = null;
    }

    _checkDayRollover() {
        const date = new Date();
        const dayIndex = date.getDate() - 1;
        const month = date.getMonth() + 1;
        const year = date.getFullYear();

        if (month !== this._currentMonth || year !== this._currentYear) {
            this._updateData(); // New month, fetch API
        } else if (dayIndex !== this._currentDayIndex) {
             if (this._monthlyData) {
                 this._parseData(this._monthlyData); // New day, use cache
             }
        }
    }

    _getCacheFile(city, country, month, year) {
        const safeCity = (city || 'auto').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const safeCountry = (country || 'auto').replace(/[^a-z0-9]/gi, '_').toLowerCase();
        return this.dir.get_child(`cached_times_${safeCity}_${safeCountry}_${month}_${year}.json`);
    }

    async _updateData() {
        if (!this._indicator) return;

        let city, country;
        const isAuto = this._settings.get_boolean('auto-location');
        
        if (isAuto) {
            let tzId = GLib.TimeZone.new_local().get_identifier();
            let parts = tzId.split('/');
            city = parts.length > 1 ? parts[parts.length - 1].replace(/_/g, ' ') : tzId;
            country = '';
            this._locationItem.label.get_clutter_text().set_markup(`<b>${city} (Auto)</b>`);
        } else {
            city = this._settings.get_string('city');
            country = this._settings.get_string('country');
            this._locationItem.label.get_clutter_text().set_markup(`<b>${city}, ${country}</b>`);
        }

        const date = new Date();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();

        const url = `https://api.aladhan.com/v1/calendarByCity?city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}&method=2&month=${month}&year=${year}`;
        const cacheFile = this._getCacheFile(city, country, month, year);

        try {
            let msg = Soup.Message.new('GET', url);
            let bytes = await this._httpSession.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, this._cancellable);
            
            if (msg.status_code === 200) {
                try {
                    cacheFile.replace_contents(bytes.toArray(), null, false, Gio.FileCreateFlags.NONE, null);
                } catch (e) {
                    console.warn(`[PrayerTimes] Cache write failed: ${e.message}`);
                }
                
                let text = new TextDecoder('utf-8').decode(bytes.toArray());
                let data = JSON.parse(text);
                this._monthlyData = data;
                this._parseData(data);
                return;
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.warn(`[PrayerTimes] API fetch failed, using cache: ${e.message}`);
            } else {
                return;
            }
        }

        try {
            if (cacheFile.query_exists(null)) {
                let [success, contents] = cacheFile.load_contents(null);
                if (success) {
                    let text = new TextDecoder('utf-8').decode(contents);
                    let data = JSON.parse(text);
                    this._monthlyData = data;
                    this._parseData(data);
                }
            }
        } catch (e) {
            console.error(`[PrayerTimes] Cache read failed: ${e.message}`);
        }
    }

    _parseData(data) {
        if (!this._indicator) return;
        if (!data || !data.data || !Array.isArray(data.data)) return;
        
        let date = new Date();
        this._currentDayIndex = date.getDate() - 1;
        this._currentMonth = date.getMonth() + 1;
        this._currentYear = date.getFullYear();
        
        if (this._currentDayIndex >= 0 && this._currentDayIndex < data.data.length) {
            let todayData = data.data[this._currentDayIndex];
            this._timings = Object.assign({}, todayData.timings);
            
            // Strip timezone offsets
            for (let prayer in this._timings) {
                this._timings[prayer] = this._timings[prayer].split(' ')[0];
            }
            
            this._updateMenu();
            this._updateCountdown();
        }
    }

    _formatTime(timeStr) {
        if (!timeStr) return '--:--';
        let is12h = this._settings.get_boolean('time-format-12h');
        if (!is12h) return timeStr;

        let [hours, minutes] = timeStr.split(':').map(Number);
        let ampm = hours >= 12 ? 'PM' : 'AM';
        let h12 = hours % 12;
        if (h12 === 0) h12 = 12;
        let mStr = minutes.toString().padStart(2, '0');
        return `${h12}:${mStr} ${ampm}`;
    }

    _updateMenu() {
        if (!this._timings || !this._indicator) return;
        
        let currentPrayer = this._getCurrentPrayer();
        
        for (let prayer of PRAYERS) {
            if (this._timings[prayer]) {
                let timeFmt = this._formatTime(this._timings[prayer]);
                let nameTxt = prayer;
                
                if (prayer === currentPrayer) {
                    nameTxt = `<b>${prayer}</b>`;
                    timeFmt = `<b>${timeFmt}</b>`;
                }
                
                this._prayerItems[prayer].nameLabel.get_clutter_text().set_markup(nameTxt);
                this._prayerItems[prayer].timeLabel.get_clutter_text().set_markup(timeFmt);
            }
        }
    }

    _getCurrentPrayer() {
        if (!this._timings) return null;
        let now = new Date();
        let currentPrayer = 'Isha';

        for (let i = 0; i < PRAYERS.length; i++) {
            let prayer = PRAYERS[i];
            let timeStr = this._timings[prayer];
            if (!timeStr) continue;
            
            let [hours, minutes] = timeStr.split(':').map(Number);
            let prayerDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
            
            if (prayerDate > now) {
                currentPrayer = i > 0 ? PRAYERS[i - 1] : 'Isha';
                break;
            }
        }
        
        return currentPrayer;
    }

    _updateCountdown() {
        if (!this._indicator) return;
        if (!this._timings) {
            this._waqtLabel.text = '...';
            this._countdownLabel.text = '...';
            return;
        }

        let now = new Date();
        let nextPrayer = null;
        let nextPrayerTime = null;

        for (let prayer of PRAYERS) {
            let timeStr = this._timings[prayer];
            if (!timeStr) continue;
            
            let [hours, minutes] = timeStr.split(':').map(Number);
            let prayerDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
            
            if (prayerDate > now) {
                nextPrayer = prayer;
                nextPrayerTime = prayerDate;
                break;
            }
        }

        // If today's prayers are over, next is tomorrow's Fajr
        if (!nextPrayer && this._timings['Fajr']) {
            nextPrayer = 'Fajr';
            let [hours, minutes] = this._timings['Fajr'].split(':').map(Number);
            nextPrayerTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hours, minutes, 0);
        }

        if (nextPrayerTime) {
            let diffMs = nextPrayerTime - now;
            let diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
            let diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            
            let hrStr = diffHrs > 0 ? `${diffHrs}h ` : '';
            
            let currentPrayer = this._getCurrentPrayer();
            
            this._waqtLabel.text = currentPrayer ? currentPrayer : '';
            this._countdownLabel.text = `${hrStr}${diffMins}m Left`;
        }

        this._updateMenu();
    }
}
