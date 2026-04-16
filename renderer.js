/**
 * Leef Browser 
 * Renderer Process Core Architecture
 */

// --- UTILITIES ---
class BrowserUtils {
  static parseAddress(str, engineBaseUrl) {
    str = str.trim();
    const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/.*)?$/;
    if (!str.includes(' ') && (domainPattern.test(str) || str.startsWith('http://') || str.startsWith('https://') || str.startsWith('localhost:'))) {
      if (!str.startsWith('http://') && !str.startsWith('https://')) return 'https://' + str;
      return str;
    }
    return engineBaseUrl + encodeURIComponent(str);
  }
}

// --- DOM REFERENCES ---
const UI = {
  views: {
    home: document.getElementById('home-view'),
    settings: document.getElementById('settings-view'),
    changelog: document.getElementById('changelog-view'),
    webviewsContainer: document.getElementById('webviews-container')
  },
  tabsContainer: document.getElementById('tabs-container'),
  inputs: {
    address: document.getElementById('address-input'),
    searchEngine: document.getElementById('search-engine-select')
  },
  buttons: {
    newTab: document.getElementById('btn-new-tab'),
    back: document.getElementById('btn-back'),
    forward: document.getElementById('btn-forward'),
    refresh: document.getElementById('btn-refresh'),
    settings: document.getElementById('btn-settings'),
    clearData: document.getElementById('btn-clear-data'),
    defaultBrowser: document.getElementById('btn-default-browser'),
    whatsNew: document.getElementById('btn-whats-new')
  }
};

// --- MANAGERS ---

class SettingsManager {
  constructor() {
    this.defaultSettings = {
      searchEngine: 'https://www.google.com/search?q=',
      startup: 'newtab',
      language: 'en',
      zoom: '1.0',
      fontSize: 'medium',
      tracking: 'standard',
      httpsOnly: true,
      adBlocker: true,
      backgroundLimit: true,
      allowNotifications: true,
      askDownload: false,
      customUa: '',
      dohToggle: false,
      proxyUrl: ''
    };
    this.currentSettings = { ...this.defaultSettings };
    this.bindEvents();
  }

  bindEvents() {
    // Nav sidebar logic
    const settingsNavItems = document.querySelectorAll('.settings-nav li');
    const settingsSections = document.querySelectorAll('.settings-section');

    settingsNavItems.forEach(item => {
      item.addEventListener('click', () => {
        settingsSections.forEach(s => s.classList.remove('active'));
        settingsNavItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        document.getElementById(item.getAttribute('data-section')).classList.add('active');
      });
    });

    // Auto-save settings on change
    document.querySelectorAll('.settings-layout input, .settings-layout select').forEach(el => {
      el.addEventListener('change', () => this.saveSettings());
    });

    // IPC Buttons
    if (UI.buttons.clearData) {
      UI.buttons.clearData.addEventListener('click', () => {
        try { window.require('electron').ipcRenderer.send('clear-data'); alert('Browsing data cleared securely!'); } catch(e){}
      });
    }
    if (UI.buttons.defaultBrowser) {
      UI.buttons.defaultBrowser.addEventListener('click', () => {
        try { window.require('electron').ipcRenderer.send('set-default-browser'); alert('Configured as default browser!'); } catch(e){}
      });
    }
  }

  saveSettings() {
    if(!document.getElementById('search-engine-select')) return; // safety
    this.currentSettings = {
      searchEngine: document.getElementById('search-engine-select').value,
      startup: document.querySelector('input[name="startup"]:checked')?.value || 'newtab',
      language: document.getElementById('language-select').value,
      zoom: document.getElementById('zoom-select').value,
      fontSize: document.getElementById('font-size-select').value,
      tracking: document.querySelector('input[name="tracking"]:checked')?.value || 'standard',
      httpsOnly: document.getElementById('https-only').checked,
      adBlocker: document.getElementById('ad-blocker').checked,
      backgroundLimit: document.getElementById('background-limit').checked,
      allowNotifications: document.getElementById('allow-notifications').checked,
      askDownload: document.getElementById('ask-download').checked,
      customUa: document.getElementById('custom-ua').value,
      dohToggle: document.getElementById('doh-toggle').checked,
      proxyUrl: document.getElementById('proxy-url').value
    };
    
    this.applyVisualSettings();
    
    try {
      window.require('electron').ipcRenderer.send('apply-settings', this.currentSettings);
    } catch (e) { console.log("IPC not available", e); }
  }

  applyVisualSettings() {
    // Font
    let px = '16px';
    if (this.currentSettings.fontSize === 'small') px = '12px';
    if (this.currentSettings.fontSize === 'large') px = '20px';
    if (this.currentSettings.fontSize === 'very-large') px = '24px';
    document.body.style.fontSize = px;
    
    // Zoom propagates via TabManager later
    if (window.tabManager) {
      window.tabManager.applyZoomToAll(parseFloat(this.currentSettings.zoom) || 1.0);
    }
  }
}

class BookmarksManager {
  constructor() {
    this.btnBookmarks = document.getElementById('btn-bookmarks');
    this.dropdown = document.getElementById('bookmarks-dropdown');
    this.btnAdd = document.getElementById('btn-add-bookmark');
    this.list = document.getElementById('bookmarks-list');
    this.saved = [];
    
    this.bindEvents();
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem('leef_bookmarks');
      if (raw) this.saved = JSON.parse(raw);
    } catch(e) {}
    this.render();
  }

  save() {
    localStorage.setItem('leef_bookmarks', JSON.stringify(this.saved));
  }

  render() {
    if (!this.list) return;
    this.list.innerHTML = '';
    if (this.saved.length === 0) {
      this.list.innerHTML = '<p style="opacity: 0.6; padding: 10px; font-size: 0.9rem;">No bookmarks saved yet.</p>';
      return;
    }
    
    this.saved.forEach((bm, i) => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      const faviconUrl = bm.url.includes('http') ? `https://www.google.com/s2/favicons?domain=${new URL(bm.url).hostname}&sz=32` : '';
      
      item.innerHTML = `
        <img class="bookmark-favicon" src="${faviconUrl}" onerror="this.style.display='none'">
        <div class="bookmark-title">${bm.title}</div>
        <button class="bookmark-delete" data-index="${i}">×</button>
      `;
      
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-delete')) return;
        if (window.tabManager) {
          window.tabManager.navigateToUrl(bm.url);
          this.dropdown.style.display = 'none';
        }
      });
      
      item.querySelector('.bookmark-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.saved.splice(i, 1);
        this.save();
        this.render();
      });
      
      this.list.appendChild(item);
    });
  }

  bindEvents() {
    if (!this.btnBookmarks || !this.dropdown) return;
    
    this.btnBookmarks.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.dropdown.style.display === 'none') {
        this.render();
        this.dropdown.style.display = 'flex';
      } else {
        this.dropdown.style.display = 'none';
      }
    });

    this.btnAdd.addEventListener('click', () => {
      if (!window.tabManager || !window.tabManager.activeTabId) return;
      const tab = window.tabManager.getActiveTab();
      if (!tab || tab.isInternal) {
        alert("You cannot bookmark this internal page.");
        return;
      }
      if (!this.saved.find(b => b.url === tab.url)) {
        this.saved.push({ title: tab.title, url: tab.url });
        this.save();
        this.render();
      } else {
        alert("This page is already bookmarked!");
      }
    });

    document.addEventListener('click', (e) => {
      if (this.dropdown.style.display !== 'none' && !this.dropdown.contains(e.target) && e.target !== this.btnBookmarks && !this.btnBookmarks.contains(e.target)) {
        this.dropdown.style.display = 'none';
      }
    });
  }
}

class NewsService {
  constructor() {
    this.loadNews();
  }

  loadNews() {
    const container = document.getElementById('dynamic-news-container');
    if (!container) return;
    try {
      const https = window.require('https');
      https.get('https://news.yahoo.com/rss/', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const xml = new DOMParser().parseFromString(data, 'text/xml');
            const items = xml.querySelectorAll('item');
            let html = '';
            const maxItems = Math.min(items.length, 3);
            
            for(let i=0; i<maxItems; i++) {
              const item = items[i];
              const title = item.querySelector('title')?.textContent || 'Breaking News';
              const link = item.querySelector('link')?.textContent || 'https://news.yahoo.com';
              let imgSrc = 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=300&h=200&fit=crop';
              const mediaCont = item.getElementsByTagName('media:content');
              if (mediaCont && mediaCont.length > 0 && mediaCont[0].getAttribute('url')) {
                imgSrc = mediaCont[0].getAttribute('url');
              }
              html += `
                <div class="news-card" data-url="${link}">
                  <img src="${imgSrc}" alt="News" class="news-img">
                  <div class="news-content">
                    <p>${title}</p>
                    <div class="news-source source-yahoo">Yahoo News <span class="external-icon">↗</span></div>
                  </div>
                </div>
              `;
            }
            container.innerHTML = html;
            // Bind click routing
            container.querySelectorAll('.news-card').forEach(tile => {
              tile.addEventListener('click', () => {
                if(window.tabManager) window.tabManager.navigateToUrl(tile.getAttribute('data-url'));
              });
            });
          } catch(e) { container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Failed to parse latest news.</p>'; }
        });
      }).on('error', () => { container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Failed to load latest news.</p>'; });
    } catch (e) { container.innerHTML = '<p style="opacity: 0.6; padding-left: 10px;">Offline news mode.</p>'; }
  }
}

class TabManager {
  constructor(settingsInstance) {
    this.settings = settingsInstance;
    this.tabs = [];
    this.activeTabId = null;
    this.tabCounter = 0;
    
    this.bindGlobalEvents();
  }

  getActiveTab() {
    return this.tabs.find(t => t.id === this.activeTabId);
  }

  applyZoomToAll(zoom) {
    this.tabs.forEach(t => {
      if (t.webviewEl && typeof t.webviewEl.setZoomFactor === 'function') {
        try { t.webviewEl.setZoomFactor(zoom); } catch(e){}
      }
    });
  }

  createTab(route = 'home') {
    const tabId = 'tab-' + this.tabCounter++;
    const isInternal = ['home', 'settings', 'changelog'].includes(route);
    
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    tabEl.id = tabId;
    
    const tabTitle = document.createElement('div');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = route === 'home' ? 'Leef Browser | Home' : (route === 'settings' ? 'Settings' : (route === 'changelog' ? "What's New" : 'Loading...'));
    
    const tabClose = document.createElement('button');
    tabClose.className = 'tab-close';
    tabClose.innerHTML = '×';
    
    tabEl.appendChild(tabTitle);
    tabEl.appendChild(tabClose);
    UI.tabsContainer.insertBefore(tabEl, UI.buttons.newTab);
    
    const tabObj = {
      id: tabId,
      url: route, // 'home', 'settings', 'changelog', or 'https://...'
      title: tabTitle.textContent,
      tabEl,
      tabTitle,
      webviewEl: null, // Lazy loaded
      canGoBack: false,
      canGoForward: false,
      isInternal: isInternal
    };
    
    this.tabs.push(tabObj);

    // Initial Routing setup
    if (!isInternal) {
      this.mountWebview(tabObj);
      tabObj.url = BrowserUtils.parseAddress(route, this.settings.currentSettings.searchEngine);
      tabObj.webviewEl.src = tabObj.url;
    }

    // Events
    tabEl.addEventListener('click', (e) => {
      if (e.target !== tabClose) this.switchTab(tabId);
    });
    tabClose.addEventListener('click', () => this.closeTab(tabId));
    
    this.switchTab(tabId);
  }

  mountWebview(tab) {
    if (tab.webviewEl) return; // Already exists
    tab.webviewEl = document.createElement('webview');
    tab.webviewEl.id = 'webview-' + tab.id;
    UI.views.webviewsContainer.appendChild(tab.webviewEl);
    
    tab.webviewEl.addEventListener('did-start-loading', () => {
      tab.title = 'Loading...';
      tab.url = tab.webviewEl.src;
      this.updateTabUI(tab);
    });
    
    tab.webviewEl.addEventListener('did-stop-loading', () => {
      tab.title = tab.webviewEl.getTitle() || tab.url;
      tab.url = tab.webviewEl.getURL();
      tab.canGoBack = tab.webviewEl.canGoBack();
      tab.canGoForward = tab.webviewEl.canGoForward();
      if (typeof tab.webviewEl.setZoomFactor === 'function') {
         try { tab.webviewEl.setZoomFactor(parseFloat(this.settings.currentSettings.zoom) || 1.0); } catch(e){}
      }
      this.updateTabUI(tab);
    });
  }

  navigateToUrl(rawInput) {
    const tab = this.getActiveTab();
    if (!tab) return;
    const fullUrl = BrowserUtils.parseAddress(rawInput, this.settings.currentSettings.searchEngine);
    
    if (!tab.webviewEl) {
      // Lazy load instantiation
      this.mountWebview(tab);
    }
    
    tab.isInternal = false;
    tab.url = fullUrl;
    tab.webviewEl.src = fullUrl;
    this.switchTab(tab.id); // Triggers re-render out of home layer
  }

  updateTabUI(tab) {
    if (tab.url === 'home') tab.tabTitle.textContent = 'Leef Browser | Home';
    else if (tab.url === 'settings') tab.tabTitle.textContent = 'Settings';
    else if (tab.url === 'changelog') tab.tabTitle.textContent = "What's New";
    else tab.tabTitle.textContent = tab.title;

    if (this.activeTabId === tab.id) {
      if (!tab.isInternal) UI.inputs.address.value = tab.url;
      else UI.inputs.address.value = '';
    }
  }

  switchTab(tabId) {
    this.activeTabId = tabId;
    const tab = this.getActiveTab();
    if (!tab) return;
    
    this.tabs.forEach(t => {
      t.tabEl.classList.remove('active');
      if (t.webviewEl) t.webviewEl.classList.remove('active');
    });
    tab.tabEl.classList.add('active');
    
    // Manage Views
    UI.views.home.style.display = tab.url === 'home' ? 'flex' : 'none';
    UI.views.settings.style.display = tab.url === 'settings' ? 'flex' : 'none';
    UI.views.changelog.style.display = tab.url === 'changelog' ? 'flex' : 'none';
    
    if (tab.isInternal) {
      UI.views.webviewsContainer.classList.remove('active');
      UI.inputs.address.value = '';
    } else {
      UI.views.webviewsContainer.classList.add('active');
      if (tab.webviewEl) tab.webviewEl.classList.add('active');
      UI.inputs.address.value = tab.url;
    }
  }

  closeTab(tabId) {
    const index = this.tabs.findIndex(t => t.id === tabId);
    if (index === -1) return;
    
    const tab = this.tabs[index];
    tab.tabEl.remove();
    if (tab.webviewEl) tab.webviewEl.remove();
    this.tabs.splice(index, 1);
    
    if (this.tabs.length === 0) {
      this.createTab('home');
    } else if (this.activeTabId === tabId) {
      this.switchTab(this.tabs[Math.max(0, index - 1)].id);
    }
  }

  bindGlobalEvents() {
    UI.buttons.newTab.addEventListener('click', () => this.createTab('home'));
    
    if (UI.buttons.settings) UI.buttons.settings.addEventListener('click', () => this.createTab('settings'));
    if (UI.buttons.whatsNew) UI.buttons.whatsNew.addEventListener('click', () => this.createTab('changelog'));

    // Address Bar
    UI.inputs.address.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.navigateToUrl(UI.inputs.address.value);
    });

    // Sub-components routing
    document.querySelectorAll('.hub-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        const url = tile.getAttribute('data-url');
        if (url) this.navigateToUrl(url);
      });
    });

    // Browser Controls
    UI.buttons.back.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl && tab.webviewEl.canGoBack()) tab.webviewEl.goBack();
    });

    UI.buttons.forward.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl && tab.webviewEl.canGoForward()) tab.webviewEl.goForward();
    });

    UI.buttons.refresh.addEventListener('click', () => {
      const tab = this.getActiveTab();
      if (tab && !tab.isInternal && tab.webviewEl) tab.webviewEl.reload();
    });
  }
}

// --- BOOTSTRAP ---
window.onload = () => {
  const settingsMgr = new SettingsManager();
  window.tabManager = new TabManager(settingsMgr); 
  const bookmarksMgr = new BookmarksManager();
  const newsSvc = new NewsService();

  // Load purely memory-optimized init
  window.tabManager.createTab('home');
};
