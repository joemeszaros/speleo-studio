# 🦇 Speleo Studio

<div align="center">

<img src="images/logo.png" alt="Speleo Studio Logo" width="200" height="200">

**A modern web application for cave visualization and survey management**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-Visit%20App-blue?style=for-the-badge&logo=github)](https://joemeszaros.github.io/speleo-studio/)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg?style=for-the-badge)](https://opensource.org/licenses/Apache-2.0)
[![GitHub Issues](https://img.shields.io/github/issues/joemeszaros/speleo-studio?style=for-the-badge)](https://github.com/joemeszaros/speleo-studio/issues)
[![GitHub Stars](https://img.shields.io/github/stars/joemeszaros/speleo-studio?style=for-the-badge)](https://github.com/joemeszaros/speleo-studio/stargazers)

</div>

## 🌟 Overview

Speleo Studio is a comprehensive web-based application designed specifically for cave exploration, surveying, and visualization. Built with modern web technologies, it provides professional tools for 3D cave system visualization, survey data management, and analysis - all without requiring any software installation.

Whether you're a professional speleologist, cave researcher, or enthusiast, Speleo Studio offers an intuitive platform to visualize, analyze, and manage cave survey data with unprecedented ease and precision.

## ✨ Key Features

### 🎯 **3D Visualization**

- **Interactive 3D rendering** powered by Three.js
- **Real-time navigation** with zoom, pan, and rotation controls
- **Multiple view modes**: Plan, Profile, and 3D perspectives
- **Customizable appearance** with various color schemes and gradients
- **Surface mesh visualization** for detailed cave topology

### 📊 **Survey Data Management**

- **Multi-format import**: TopoDroid CSV, Polygon, JSON, PLY files
- **Real-time editing** of survey stations and connections
- **Data validation** and error detection
- **Project management** with automatic saving
- **Export capabilities** to multiple formats (PNG, DXF, Polygon, JSON)

### 🛠️ **Professional Tools**

- **Dip & Strike Calculator** for geological analysis
- **Shortest Path Finder** for route optimization
- **Point Selection** with raycasting technology
- **Grid overlay** for precise measurements
- **Print functionality** for documentation

### 🌐 **Modern Web Technology**

- **No installation required** - runs entirely in your browser
- **Cross-platform compatibility** (Windows, macOS, Linux)
- **Responsive design** that works on desktop and tablet devices
- **Local data storage** for privacy and offline capability

### 📲 **Installable & Offline (PWA)**

- **Installable** to your desktop or mobile home screen, running in its own standalone window
- **Works fully offline** - once loaded, 3D visualization, survey editing, and import/export run with no internet connection
- **Automatic updates** - the cached app refreshes whenever a new version is deployed
- **Note**: a few online-only features degrade gracefully when offline - Google Drive sync, magnetic declination lookup, and fetching remote images/map tiles

### 🌍 **Multi-Language Support**

- **Internationalization (i18n)** built-in with English and Hungarian languages
- **Extensible translation system** for easy addition of new languages
- **Complete UI localization** including menus, tooltips, and messages

## 🚀 Quick Start

### Try It Now

Visit the live application: **[Speleo Studio Live Demo](https://joemeszaros.github.io/speleo-studio/)**

### Local Development

```bash
# Clone the repository
git clone https://github.com/joemeszaros/speleo-studio.git
cd speleo-studio

# Serve the application (no build process required!)
# Option 1: Using Python
python -m http.server 8000

# Option 2: Using Node.js
npx serve .

# Option 3: Using any web server
# Simply open index.html in your browser
```

Then open `http://localhost:8000` in your browser.

### Install as an App

Speleo Studio is a Progressive Web App. In a supported browser, open the app and choose **Install** (the install icon in the address bar, or *⋮ → Install Speleo Studio*) to add it to your desktop or home screen. After the first load it works offline.

> The service worker that powers offline support is only active over **HTTPS or `localhost`** (a `file://` page won't register it).

### Updating the offline cache

The list of files cached for offline use is generated and committed as `precache-manifest.js`. Whenever you change app assets, regenerate it (the cache version is a content hash, so users' caches refresh automatically on next visit):

```bash
npm run build:sw
```

## 📁 Supported File Formats

| Format            | Import | Export | Description                              |
| ----------------- | ------ | ------ | ---------------------------------------- |
| **TopoDroid CSV** | ✅     | ✅     | Popular mobile cave surveying app format |
| **Polygon**       | ✅     | ✅     | Traditional cave mapping software format |
| **JSON**          | ✅     | ✅     | Modern structured data format            |
| **PLY**           | ✅     | ❌     | 3D surface mesh format                   |
| **PNG**           | ❌     | ✅     | High-quality image export                |
| **DXF**           | ❌     | ✅     | CAD-compatible vector format             |

## 🎮 How to Use

1. **Import Data**: Load your cave survey data from TopoDroid, Polygon, or JSON files
2. **Visualize**: Explore your cave system in interactive 3D
3. **Edit**: Modify stations, connections, and attributes as needed
4. **Analyze**: Use built-in tools for geological analysis and pathfinding
5. **Export**: Save your work in various formats for documentation or further analysis

## 🏗️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **3D Graphics**: Three.js for WebGL rendering
- **Data Management**: Tabulator.js for table operations
- **Storage**: Browser LocalStorage and IndexedDB for data persistence
- **Offline**: Service Worker + Web App Manifest (installable PWA)

## 🤝 Contributing

We welcome contributions from the speleology community! Here's how you can help:

### 🐛 **Bug Reports**

Found a bug? Please report it on our [GitHub Issues](https://github.com/joemeszaros/speleo-studio/issues) page.

### ✨ **Feature Requests**

Have an idea for a new feature? We'd love to hear about it!

### 🌍 **Translations**

Help make Speleo Studio available in more languages by contributing translations.

### 💻 **Code Contributions**

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📚 Documentation

- **[User Manual](https://joemeszaros.github.io/speleo-studio/manual/hu/)** - Comprehensive guide (Hungarian)
- **[Attribute Reference](https://joemeszaros.github.io/speleo-studio/attributes.html)** - Complete attribute documentation

## 🎯 Project Goals

Speleo Studio aims to:

- **Replace legacy software** like Polygon (used in Hungary since the 1990s)
- **Friend of TopoDroid users** provide a platform for TopoDroid users whey they can manage their surveys on desktop

- **Improve accessibility** by eliminating installation requirements
- **Foster collaboration** through open-source development
- **Support scientific research** with professional analysis tools

## 👨‍💻 About the Developer

**Mészáros József (Joe)** - Passionate caver and software developer

- 🔗 **GitHub**: [@joemeszaros](https://github.com/joemeszaros)
- 📧 **Email**: joe.meszaros _at_ gmail.com
- 🕳️ **Background**: Cave explorer who learned web development to create better tools for the speleology community

## 📄 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Barlangtani Intézet** for testing and suggestions
- **Three.js community** for the amazing 3D graphics library
- **Open source contributors** who make projects like this possible

---

<div align="center">

**⭐ If you find Speleo Studio useful, please give it a star! ⭐**

Made with ❤️ for the speleology community

</div>
