# Internationalization (i18n) System

This is a home-built internationalization system for Speleo Studio that supports multiple languages, template interpolation, and automatic language detection.

## Features

- **Multi-language Support**: Currently supports English (en) and Hungarian (hu)
- **Country Flags**: Visual flag indicators for each language (🇺🇸 English, 🇭🇺 Magyar)
- **Automatic Language Detection**: Detects user's browser language preference
- **Template Interpolation**: Supports parameter substitution in translation strings
- **Language Persistence**: Remembers user's language choice in localStorage
- **Dynamic Updates**: Automatically updates UI when language changes
- **Fallback Support**: Falls back to English if translations are missing
- **Persistent Language Selector**: Language selector automatically reappears if removed
- **Smart Initialization**: Waits for translations to load before building UI components

## File Structure

```
src/i18n/
├── i18n.js                    # Main i18n manager class
├── translations/
│   ├── en.json               # English translations
│   └── hu.json               # Hungarian translations
└── README.md                  # This documentation
```

## Usage

### Basic Translation

```javascript
import { i18n } from './src/i18n/i18n.js';

// Simple translation
const text = i18n.t('menu.file.name'); // Returns "File" or "Fájl"

// Translation with parameters
const message = i18n.t('welcome.message', { name: 'John' });
// If translation is "Welcome {{name}}!", returns "Welcome John!"
```

### Adding New Languages

1. Create a new translation file in `src/i18n/translations/` (e.g., `de.json` for German)
2. Add the language code and display name to the `supportedLanguages` object

```javascript
// In i18n.js
this.supportedLanguages = new Map([
  ['en', 'English',]
  ['hu', 'Magyar',]
  ['de', 'Deutsch']
]);
```

### Adding New Translation Keys

1. Add the key to all language files
2. Use nested structure for organization (e.g., `menu.file.new`)
3. Support template interpolation with `{{paramName}}` syntax

```json
// In en.json
{
  "menu": {
    "file": {
      "new": "New cave"
    }
  }
}

// In hu.json
{
  "menu": {
    "file": {
      "new": "Új barlang"
    }
  }
}
```

### Template Interpolation

Translation strings can include parameters that get substituted at runtime:

```json
{
  "welcome": {
    "message": "Welcome {{name}}! You have {{count}} caves."
  }
}
```

```javascript
const message = i18n.t('welcome.message', {
  name  : 'John',
  count : 5
});
// Returns "Welcome John! You have 5 caves."
```

### Language Management

```javascript
// Get current language
const currentLang = i18n.getCurrentLanguage();

// Get supported languages
const languages = i18n.getSupportedLanguages();

// Change language
await i18n.changeLanguage('hu');

// Listen for language changes
document.addEventListener('languageChanged', (event) => {
  console.log('Language changed to:', event.detail.language);
  // Update your UI here
});
```

## Integration with Components

### Reacting to Language Changes

Components should listen for the `languageChanged` event and update their content:

```javascript
document.addEventListener('languageChanged', () => {
  // Refresh component content
  this.updateTranslations();
});

updateTranslations() {
  this.element.textContent = i18n.t('component.text');
}
```

### Using in HTML

You can use data attributes for automatic translation updates:

```html
<!-- Text content -->
<span data-i18n="menu.file.name">File</span>

<!-- Title attribute -->
<button data-i18n-title="tooltips.print">Print</button>

<!-- With parameters -->
<span data-i18n="welcome.message" data-i18n-param-name="John">Welcome John!</span>
```

## CSS Styling

The language selector is styled in `css/i18n.css` and automatically integrates with the navbar. The styles are designed to match the existing Speleo Studio theme.

## Browser Compatibility

- Modern browsers with ES6 module support
- Automatic fallback to English for unsupported languages
- Graceful degradation if translation files fail to load

## Performance Considerations

- Translation files are loaded asynchronously
- Language changes trigger UI updates only when necessary
- Translations are cached in memory after first load

## Troubleshooting

### Common Issues

1. **Translations not loading**: Check file paths and ensure JSON files are valid
2. **Language selector not appearing**: Verify the navbar has the correct CSS class (`.topnavbar`)
3. **Missing translations**: Check console for warnings about missing keys
4. **Menu shows translation keys instead of text**: Ensure i18n system is fully loaded before building navbar
5. **Language selector disappears after language change**: The system automatically recreates it, check console for messages
6. **Initial language detection not working**: Check browser language settings and localStorage

### Debug Mode

Enable debug logging by checking the browser console for i18n-related messages.

## Future Enhancements

- Pluralization support (e.g., "1 cave" vs "2 caves")
- Date and number formatting
- RTL language support
- Translation memory for better performance
- Crowdsourced translation contributions
