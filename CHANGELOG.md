# Changelog

All notable changes to Speleo Studio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-language support (English and Hungarian)
- Comprehensive user manual in Hungarian
- Attribute reference documentation

### Changed

- Improved UI responsiveness
- Enhanced 3D visualization performance

### Fixed

- Various bug fixes and stability improvements

## [1.0.0] - 2025-09-25

### Added

- **3D Visualization Engine**

  - Interactive 3D cave rendering powered by Three.js
  - Real-time navigation with zoom, pan, and rotation controls
  - Multiple view modes: Plan, Profile, and 3D perspectives
  - Customizable appearance with various color schemes and gradients
  - Surface mesh visualization (PLY format support)

- **Survey Data Management**

  - Multi-format import: TopoDroid CSV, Polygon, JSON files
  - Real-time editing of survey stations and connections
  - Data validation and error detection
  - Project management with automatic saving
  - Export capabilities to multiple formats (PNG, DXF, Polygon, JSON)

- **Professional Tools**

  - Dip & Strike Calculator for geological analysis
  - Shortest Path Finder for route optimization
  - Point Selection with raycasting technology
  - Grid overlay for precise measurements
  - Print functionality for documentation

- **Modern Web Technology**

  - No installation required - runs entirely in browser
  - Cross-platform compatibility (Windows, macOS, Linux)
  - Responsive design for desktop and tablet devices
  - Local data storage for privacy and offline capability

- **User Interface**

  - Intuitive navigation with sidebar and toolbar
  - Settings panel with extensive customization options
  - Project manager for organizing cave data
  - Attribute system for detailed cave documentation

- **File Format Support**
  - TopoDroid CSV import/export
  - Polygon format import/export
  - JSON format for modern data exchange
  - PLY format for 3D surface meshes
  - PNG export for high-quality images
  - DXF export for CAD compatibility

### Technical Details

- Built with HTML5, CSS3, JavaScript (ES6+)
- Three.js for WebGL 3D graphics
- Tabulator.js for data table management
- Browser LocalStorage and IndexedDB for data persistence
- Prettier for code formatting
- ESLint for code quality

### Documentation

- Comprehensive user manual in Hungarian
- Attribute reference guide
- Developer documentation
- GitHub repository with open source code

---

## Version History

- **v1.0.0** (2024-12-19): Initial stable release with core functionality
- **v0.x.x** (Development): Pre-release development versions

## Release Notes

### v1.0.0 Release Notes

This is the first stable release of Speleo Studio, marking a significant milestone in cave visualization software. The application provides a complete solution for cave survey data management and 3D visualization, designed to replace legacy tools like Polygon while offering modern web-based functionality.

**Key Highlights:**

- Complete 3D cave visualization system
- Support for major cave surveying formats (TopoDroid, Polygon)
- Professional analysis tools (Dip & Strike, Shortest Path)
- Modern web-based architecture requiring no installation
- Open source with community contribution support

**Target Users:**

- Professional speleologists and cave researchers
- Cave exploration teams and organizations
- Academic institutions studying cave systems
- Cave mapping enthusiasts and hobbyists

---

_For more information about Speleo Studio, visit our [GitHub repository](https://github.com/joemeszaros/speleo-studio) or try the [live application](https://joemeszaros.github.io/speleo-studio/)._
