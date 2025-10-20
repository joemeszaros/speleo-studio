/*
 * Copyright 2024 Joe Meszaros
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Google Drive API integration for Speleo Studio

/**
 * Google Drive API integration for Speleo Studio
 * Handles authentication, folder management, and file operations
 */
export class GoogleDriveAPI {
  constructor(config) {
    this.config = config;
    this.baseURL = 'https://www.googleapis.com/drive/v3';
    this.authURL = 'https://oauth2.googleapis.com/token';
    this.fileIdCache = new Map();
  }

  /**
   * Get authorization URL for OAuth2 flow
   * @returns {string} Authorization URL
   */
  getAuthorizationURL() {
    const params = new URLSearchParams({
      client_id     : this.config.get('clientId'),
      redirect_uri  : window.location.origin + '/oauth-callback.html',
      response_type : 'code',
      scope         : 'https://www.googleapis.com/auth/drive.file',
      access_type   : 'offline',
      prompt        : 'consent'
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} code - Authorization code
   * @returns {Promise<Object>} Token response
   */
  async exchangeCodeForTokens(code) {
    const response = await fetch(this.authURL, {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/x-www-form-urlencoded'
      },
      body : new URLSearchParams({
        client_id     : this.config.get('clientId'),
        client_secret : this.config.get('clientSecret'),
        code          : code,
        grant_type    : 'authorization_code',
        redirect_uri  : window.location.origin + '/oauth-callback.html'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
    }

    return await response.json();
  }

  /**
   * Refresh access token using refresh token
   * @returns {Promise<Object>} Token response
   */
  async refreshAccessToken() {
    const refreshToken = this.config.get('refreshToken');
    if (!refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(this.authURL, {
      method  : 'POST',
      headers : {
        'Content-Type' : 'application/x-www-form-urlencoded'
      },
      body : new URLSearchParams({
        client_id     : this.config.get('clientId'),
        client_secret : this.config.get('clientSecret'),
        refresh_token : refreshToken,
        grant_type    : 'refresh_token'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
    }

    return await response.json();
  }

  /**
   * Get valid access token (refresh if needed)
   * @returns {Promise<string>} Valid access token
   */
  async getValidAccessToken() {
    if (this.config.hasValidTokens()) {
      return this.config.get('accessToken');
    }

    try {
      const tokenResponse = await this.refreshAccessToken();
      this.config.setTokens(tokenResponse.access_token, this.config.get('refreshToken'), tokenResponse.expires_in);
      return tokenResponse.access_token;
    } catch (error) {
      console.error('Failed to refresh access token:', error);
      this.config.clearTokens();
      throw new Error('Authentication expired. Please re-authenticate.');
    }
  }

  /**
   * Make authenticated request to Google Drive API
   * @param {string} endpoint - API endpoint
   * @param {Object} options - Fetch options
   * @returns {Promise<Response>} API response
   */
  async makeAuthenticatedRequest(endpoint, options = {}) {
    const accessToken = await this.getValidAccessToken();

    const defaultHeaders = {
      Authorization  : `Bearer ${accessToken}`,
      'Content-Type' : 'application/json',
      ...options.headers
    };

    const response = await fetch(`${this.baseURL}${endpoint}`, {
      ...options,
      headers : defaultHeaders
    });

    if (response.status === 401) {
      // Token expired, try to refresh
      try {
        const newToken = await this.getValidAccessToken();
        const newHeaders = {
          ...defaultHeaders,
          Authorization : `Bearer ${newToken}`
        };

        return await fetch(`${this.baseURL}${endpoint}`, {
          ...options,
          headers : newHeaders
        });
      } catch {
        throw new Error('Authentication failed. Please re-authenticate.');
      }
    }

    return response;
  }

  /**
   * Get user information including email address
   * @returns {Promise<Object>} User information object with email and other details
   */
  async getUserInfo() {
    const response = await this.makeAuthenticatedRequest('/about?fields=user');

    if (!response.ok) {
      throw new Error(`Failed to get user info: ${response.statusText}`);
    }

    const data = await response.json();
    return data.user;
  }

  /**
   * Get user email address
   * @returns {Promise<string>} User's email address
   */
  async getUserEmail() {
    const userInfo = await this.getUserInfo();
    return userInfo.emailAddress;
  }

  /**
   * Find or create folder by name
   * @param {string} folderName - Folder name
   * @param {string} parentId - Parent folder ID (optional)
   * @returns {Promise<string>} Folder ID
   */
  async findOrCreateFolder(folderName, parentId = null) {
    // First, try to find existing folder
    const query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const parentQuery = parentId ? ` and '${parentId}' in parents` : '';
    const fullQuery = encodeURIComponent(query + parentQuery);

    const response = await this.makeAuthenticatedRequest(`/files?q=${fullQuery}&fields=files(id,name)`);

    if (!response.ok) {
      throw new Error(`Failed to search for folder: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // Create folder if not found
    const folderMetadata = {
      name     : folderName,
      mimeType : 'application/vnd.google-apps.folder'
    };

    if (parentId) {
      folderMetadata.parents = [parentId];
    }

    const createResponse = await this.makeAuthenticatedRequest('/files', {
      method : 'POST',
      body   : JSON.stringify(folderMetadata)
    });

    if (!createResponse.ok) {
      throw new Error(`Failed to create folder: ${createResponse.statusText}`);
    }

    const createdFolder = await createResponse.json();
    return createdFolder.id;
  }

  /**
   * Get main Speleo Studio folder ID
   * @returns {Promise<string>} Folder ID
   */
  async getMainFolderId() {
    const folderName = this.config.get('folderName');
    return await this.findOrCreateFolder(folderName);
  }

  /**
   * Get caves folder ID
   * @returns {Promise<string>} Folder ID
   */
  async getCavesFolderId() {
    const mainFolderId = await this.getMainFolderId();
    const cavesFolderName = this.config.get('cavesFolderName');
    return await this.findOrCreateFolder(cavesFolderName, mainFolderId);
  }

  /**
   * Get projects folder ID
   * @returns {Promise<string>} Folder ID
   */
  async getProjectsFolderId() {
    const mainFolderId = await this.getMainFolderId();
    const projectsFolderName = this.config.get('projectsFolderName');
    return await this.findOrCreateFolder(projectsFolderName, mainFolderId);
  }

  /**
   * Upload or update file in Google Drive
   * @param {string} fileName - File name
   * @param {string} content - File content
   * @param {string} mimeType - MIME type
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<string>} File ID
   */
  async uploadOrUpdateFile(fileName, content, mimeType, folderId, description, properties) {
    // Check if file already exists
    const existingFile = await this.findFileByName(fileName, folderId);

    if (existingFile) {
      // Update existing file
      return await this.updateFile(existingFile.id, content, mimeType, description, properties);
    } else {
      // Upload new file
      return await this.uploadFile(fileName, content, mimeType, folderId, description, properties);
    }
  }

  /**
   * Update existing file content in Google Drive
   * @param {string} fileId - File ID to update
   * @param {string} content - New file content
   * @param {string} mimeType - MIME type
   * @returns {Promise<string>} File ID
   */
  async updateFile(fileId, content, mimeType, description, properties) {
    const metadata = {
      description : description,
      properties  : properties
    };
    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', new Blob([content], { type: mimeType }));

    const accessToken = await this.getValidAccessToken();

    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`, {
      method  : 'PATCH',
      headers : {
        Authorization : `Bearer ${accessToken}`
      },
      body : formData
    });

    if (!response.ok) {
      throw new Error(`Failed to update file: ${response.statusText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Upload file to Google Drive
   * @param {string} fileName - File name
   * @param {string} content - File content
   * @param {string} mimeType - MIME type
   * @param {string} parentId - Parent folder ID
   * @returns {Promise<string>} File ID
   */
  async uploadFile(fileName, content, mimeType, folderId, description, properties) {
    console.log('upload file with desc: ', description);
    const metadata = {
      name        : fileName,
      parents     : [folderId],
      description : description,
      properties  : properties
    };

    const formData = new FormData();
    formData.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    formData.append('file', new Blob([content], { type: mimeType }));

    const accessToken = await this.getValidAccessToken();

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method  : 'POST',
      headers : {
        Authorization : `Bearer ${accessToken}`
      },
      body : formData
    });

    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.statusText}`);
    }

    const result = await response.json();
    return result.id;
  }

  /**
   * Download file from Google Drive
   * @param {string} fileId - File ID
   * @returns {Promise<string>} File content
   */
  async downloadFile(fileId) {
    const response = await this.makeAuthenticatedRequest(`/files/${fileId}?alt=media`);

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    return await response.text();
  }

  /**
   * List files in folder
   * @param {string} folderId - Folder ID
   * @returns {Promise<Array>} List of files
   */
  async listFiles(folderId) {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const response = await this.makeAuthenticatedRequest(
      `/files?q=${query}&fields=files(id,name,createdTime,modifiedTime)`
    );

    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.statusText}`);
    }

    const data = await response.json();
    return data.files || [];
  }

  /**
   * Delete file from Google Drive
   * @param {string} fileId - File ID
   * @returns {Promise<void>}
   */
  async deleteFile(fileId) {
    const response = await this.makeAuthenticatedRequest(`/files/${fileId}`, {
      method : 'DELETE'
    });

    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.statusText}`);
    }
  }

  /**
   * Check if file exists by name in folder
   * @param {string} fileName - File name
   * @param {string} folderId - Folder ID
   * @returns {Promise<string|null>} File ID if exists, null otherwise
   */
  async findFileByName(fileName, folderId) {

    if (this.fileIdCache.has(fileName)) {
      console.log(`file id cache hit for ${fileName}`);
      return await this.getFileById(this.fileIdCache.get(fileName));
    }

    const query = encodeURIComponent(`name='${fileName}' and '${folderId}' in parents and trashed=false`);
    const response = await this.makeAuthenticatedRequest(`/files?q=${query}&fields=files(id,name,properties)`);

    if (!response.ok) {
      throw new Error(`Failed to search for file: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.files && data.files.length > 0) {
      const file = data.files[0];
      this.fileIdCache.set(fileName, file.id);
      return file;
    } else {
      return null;
    }
  }

  async getFileById(fileId) {
    const response = await this.makeAuthenticatedRequest(`/files/${fileId}?fields=id,name,properties`);

    if (!response.ok) {
      throw new Error(`Failed to get file: ${response.statusText}`);
    }

    return await response.json();
  }
}
