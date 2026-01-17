// Search functionality for the Speleo Studio manual
class ManualSearch {
  constructor() {
    this.searchInput = document.getElementById('searchInput');
    this.searchButton = document.getElementById('searchButton');
    this.searchResults = document.getElementById('searchResults');
    this.pages = [
      { url: '01-bevezetes.html', title: 'Bevezetés és első lépések' },
      { url: '02-projekt-kezeles.html', title: 'Projekt kezelés' },
      { url: '03-adatmodell.html', title: 'Adatmodell és struktúra' },
      { url: '04-adatok-importalasa.html', title: 'Adatok importálása' },
      { url: '05-3d-vizualizacio.html', title: '3D vizualizáció és navigáció' },
      { url: '06-barlang-szerkesztese.html', title: 'Barlang szerkesztése' },
      { url: '07-felmereek-szerkesztese.html', title: 'Felmérések szerkesztése' },
      { url: '08-attributumok.html', title: 'Attribútumok kezelése' },
      { url: '09-eszkozok.html', title: 'Eszközök és számítások' },
      { url: '10-google-drive.html', title: 'Google Drive integráció' },
      { url: '11-exportalas.html', title: 'Exportálás és megosztás' },
      { url: '12-beallitasok.html', title: 'Beállítások és testreszabás' },
      { url: '13-tamogatas.html', title: 'Támogatás és adományozás' },
      { url: '14-about.html', title: 'A projektről' }
    ];
    this.pageContent = new Map();
    this.init();
  }

  init() {
    this.searchButton.addEventListener('click', () => this.performSearch());
    this.searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.performSearch();
      }
    });
  }

  async performSearch() {
    const query = this.searchInput.value.trim();
    if (!query) {
      this.searchResults.style.display = 'none';
      return;
    }

    this.showLoading();

    try {
      // Load all pages if not already loaded
      if (this.pageContent.size === 0) {
        await this.loadAllPages();
      }

      const results = this.searchInContent(query);
      this.displayResults(results, query);
    } catch (error) {
      console.error('Search error:', error);
      this.showError('Hiba történt a keresés során. Kérjük, próbálja újra.');
    }
  }

  async loadAllPages() {
    const loadPromises = this.pages.map(async (page) => {
      try {
        const response = await fetch(page.url);
        if (!response.ok) throw new Error(`Failed to load ${page.url}`);
        const html = await response.text();
        const content = this.extractTextContent(html);
        this.pageContent.set(page.url, {
          title   : page.title,
          content : content,
          url     : page.url
        });
      } catch (error) {
        console.warn(`Could not load ${page.url}:`, error);
        // Add placeholder content for failed pages
        this.pageContent.set(page.url, {
          title   : page.title,
          content : '',
          url     : page.url
        });
      }
    });

    await Promise.all(loadPromises);
  }

  extractTextContent(html) {
    // Create a temporary DOM element to parse HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;

    // Remove script and style elements
    const scripts = tempDiv.querySelectorAll('script, style');
    scripts.forEach((el) => el.remove());

    // Get text content and clean it up
    let text = tempDiv.textContent || tempDiv.innerText || '';

    // Clean up whitespace
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  searchInContent(query) {
    const results = [];
    const searchTerms = query.toLowerCase().split(/\s+/);

    this.pageContent.forEach((pageData, url) => {
      if (!pageData.content) return;

      const content = pageData.content.toLowerCase();
      let score = 0;
      const matches = [];

      // Check for exact phrase match
      if (content.includes(query.toLowerCase())) {
        score += 100;
      }

      // Check for individual word matches
      searchTerms.forEach((term) => {
        if (content.includes(term)) {
          score += 5;
          // Find context around the match
          const index = content.indexOf(term);
          const start = Math.max(0, index - 100);
          const end = Math.min(content.length, index + 200);
          const context = content.substring(start, end);
          matches.push(context);
        }
      });

      if (score > 0) {
        results.push({
          url     : pageData.url,
          title   : pageData.title,
          score   : score,
          matches : matches,
          content : pageData.content
        });
      }
    });

    // Sort by score (highest first)
    return results.sort((a, b) => b.score - a.score);
  }

  displayResults(results, query) {
    if (results.length === 0) {
      this.searchResults.innerHTML = '<div class="no-results">Nincs találat a keresett kifejezésre.</div>';
    } else {
      const html = results
        .map((result) => {
          const excerpt = this.createExcerpt(result.content, query);
          const scorePercentage = Math.min(100, Math.round((result.score / 100) * 100));
          return `
            <div class="search-result">
              <h4><a href="${result.url}">${result.title}</a></h4>
              <div class="search-score">Relevancia: ${scorePercentage}%</div>
              <p>${excerpt}</p>
              <a href="${result.url}" class="page-link">Ugrás az oldalra →</a>
            </div>
          `;
        })
        .join('');

      this.searchResults.innerHTML = html;
    }

    this.searchResults.classList.add('show');
  }

  createExcerpt(content, query) {
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const index = contentLower.indexOf(queryLower);

    if (index === -1) {
      return content.substring(0, 200) + '...';
    }

    const start = Math.max(0, index - 100);
    const end = Math.min(content.length, index + 200);
    let excerpt = content.substring(start, end);

    // Highlight the search term
    const regex = new RegExp(`(${query})`, 'gi');
    excerpt = excerpt.replace(regex, '<span class="search-highlight">$1</span>');

    if (start > 0) excerpt = '...' + excerpt;
    if (end < content.length) excerpt = excerpt + '...';

    return excerpt;
  }

  showLoading() {
    this.searchResults.innerHTML = '<div class="search-loading">Keresés folyamatban</div>';
    this.searchResults.classList.add('show');
  }

  showError(message) {
    this.searchResults.innerHTML = `<div class="no-results">${message}</div>`;
    this.searchResults.classList.add('show');
  }
}

// Initialize search when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new ManualSearch();
});
