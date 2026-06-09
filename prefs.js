import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const LOCATIONS = {
    'Saudi Arabia': ['Mecca', 'Medina', 'Riyadh', 'Jeddah'],
    'United Kingdom': ['London', 'Birmingham', 'Manchester', 'Glasgow'],
    'United States': ['New York', 'Los Angeles', 'Chicago', 'Houston'],
    'Canada': ['Toronto', 'Vancouver', 'Montreal', 'Calgary'],
    'Australia': ['Toronto', 'Sydney', 'Melbourne', 'Brisbane'],
    'Pakistan': ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi'],
    'India': ['Mumbai', 'Delhi', 'Bangalore', 'Hyderabad'],
    'Bangladesh': ['Dhaka', 'Chittagong', 'Sylhet', 'Rajshahi'],
    'Egypt': ['Cairo', 'Alexandria', 'Giza', 'Shubra El-Kheima'],
    'Turkey': ['Cairo', 'Istanbul', 'Ankara', 'Izmir'],
    'Indonesia': ['Istanbul', 'Jakarta', 'Surabaya', 'Bandung'],
    'Malaysia': ['Jakarta', 'Surabaya', 'Bandung', 'Medan'],
    'United Arab Emirates': ['Dubai', 'Abu Dhabi', 'Sharjah', 'Al Ain'],
    'Qatar': ['Dubai', 'Doha', 'Al Wakrah', 'Al Khor'],
    'France': ['Paris', 'Marseille', 'Lyon', 'Toulouse'],
    'Germany': ['Berlin', 'Hamburg', 'Munich', 'Cologne']
};

export default class PrayerTimesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Location Settings'),
            description: _('Select your country and city to fetch accurate prayer times.'),
        });
        page.add(group);

        const autoLocationRow = new Adw.SwitchRow({
            title: _('Automatic Location'),
            subtitle: _('Use system timezone to determine location'),
            active: settings.get_boolean('auto-location'),
        });
        group.add(autoLocationRow);

        // Get current saved values
        let currentCountry = settings.get_string('country');
        let currentCity = settings.get_string('city');

        // Ensure current country exists in our list, fallback to first if not
        const countries = Object.keys(LOCATIONS).sort();
        if (!countries.includes(currentCountry)) {
            currentCountry = countries[0];
            settings.set_string('country', currentCountry);
        }

        // Country ComboRow
        const countryModel = Gtk.StringList.new(countries);
        const countryRow = new Adw.ComboRow({
            title: _('Country'),
            model: countryModel,
        });
        
        // Find index of current country
        let countryIndex = countries.indexOf(currentCountry);
        if (countryIndex !== -1) {
            countryRow.set_selected(countryIndex);
        }

        group.add(countryRow);

        // City ComboRow
        const cityRow = new Adw.ComboRow({
            title: _('City'),
        });
        group.add(cityRow);

        // Bind auto-location to disable manual selection
        settings.bind('auto-location', autoLocationRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        
        const updateSensitivity = () => {
            const isAuto = autoLocationRow.get_active();
            countryRow.set_sensitive(!isAuto);
            cityRow.set_sensitive(!isAuto);
        };
        autoLocationRow.connect('notify::active', updateSensitivity);
        updateSensitivity(); // Initial state

        // Function to update City model based on selected Country
        const updateCityModel = (country) => {
            let cities = LOCATIONS[country] || [];
            cities = [...cities].sort(); // Create copy and sort
            
            const cityModel = Gtk.StringList.new(cities);
            cityRow.set_model(cityModel);

            // Try to restore saved city or default to first
            let savedCity = settings.get_string('city');
            let idx = cities.indexOf(savedCity);
            if (idx === -1) {
                idx = 0; // Default to first city if saved one isn't in list
                if (cities.length > 0) {
                    settings.set_string('city', cities[0]);
                }
            }
            cityRow.set_selected(idx);
        };

        // Initialize City Model
        updateCityModel(currentCountry);

        // Listen for Country changes
        countryRow.connect('notify::selected-item', () => {
            let selectedItem = countryRow.get_selected_item();
            if (selectedItem) {
                let newCountry = selectedItem.get_string();
                settings.set_string('country', newCountry);
                updateCityModel(newCountry);
            }
        });

        // Listen for City changes
        cityRow.connect('notify::selected-item', () => {
            let selectedItem = cityRow.get_selected_item();
            if (selectedItem) {
                let newCity = selectedItem.get_string();
                settings.set_string('city', newCity);
            }
        });


        const timeGroup = new Adw.PreferencesGroup({
            title: _('Display Settings'),
        });
        page.add(timeGroup);

        const formatRow = new Adw.SwitchRow({
            title: _('Use 12-hour format'),
            subtitle: _('Display times in AM/PM format'),
            active: settings.get_boolean('time-format-12h'),
        });
        timeGroup.add(formatRow);

        settings.bind('time-format-12h', formatRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    }
}
