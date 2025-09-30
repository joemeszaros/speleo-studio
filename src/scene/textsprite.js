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

import * as THREE from 'three';

class TextSprite {

  constructor(label, position, font, scale = 0.5, name = 'text sprite') {
    this.font = {
      size        : font.size,
      color       : font.color ?? 'white',
      family      : font.name ?? 'Helvetica Neue',
      strokeColor : font?.strokeColor
    };
    this.label = label;
    this.position = position;
    this.scale = scale;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.sprite = this.#createSprite(label, position, this.scale, name);
  }

  #createSprite(label, position, scale, name) {
    const fontStyle = `${this.font.size}px ${this.font.family}`;
    this.ctx.font = fontStyle;

    const textMetrics = this.ctx.measureText(label);
    const textWidth = Math.ceil(textMetrics.width);
    const textHeight = this.font.size;

    this.canvas.width = textWidth * 1.2;
    this.canvas.height = textHeight * 1.2;

    this.#drawText(label, fontStyle, textWidth, textHeight);

    const spriteMap = new THREE.CanvasTexture(this.canvas);
    spriteMap.colorSpace = THREE.SRGBColorSpace;
    spriteMap.minFilter = THREE.LinearFilter;
    spriteMap.magFilter = THREE.LinearFilter;
    spriteMap.generateMipmaps = false;
    spriteMap.needsUpdate = true;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap }));
    sprite.scale.set(textWidth * scale, textHeight * scale, 1);
    sprite.position.copy(position);
    sprite.name = name;
    return sprite;
  }

  getSprite() {
    return this.sprite;
  }

  update(label) {
    if (label === this.label) return;

    this.ctx = this.canvas.getContext('2d');
    this.ctx.reset();

    const fontStyle = `${this.font.size}px ${this.font.family}`;
    this.ctx.font = fontStyle;

    // Calculate new text dimensions
    const textMetrics = this.ctx.measureText(label);
    const textWidth = Math.ceil(textMetrics.width);
    const textHeight = this.font.size;

    // Check if we need to resize canvas
    const currentCanvasWidth = this.canvas.width;
    const currentCanvasHeight = this.canvas.height;
    const newCanvasWidth = textWidth * 1.2;
    const newCanvasHeight = textHeight * 1.2;

    if (newCanvasWidth > currentCanvasWidth || newCanvasHeight > currentCanvasHeight) {
      // Resize canvas with device pixel ratio
      this.canvas.width = newCanvasWidth;
      this.canvas.height = newCanvasHeight;

      // Set display size (CSS size)
      this.canvas.style.width = newCanvasWidth + 'px';
      this.canvas.style.height = newCanvasHeight + 'px';

      // Recreate texture with new canvas
      this.sprite.material.map.dispose();
      this.sprite.material.map = new THREE.CanvasTexture(this.canvas);
      this.sprite.material.map.colorSpace = THREE.SRGBColorSpace;
      this.sprite.material.map.minFilter = THREE.LinearFilter;
      this.sprite.material.map.magFilter = THREE.LinearFilter;
      this.sprite.material.map.generateMipmaps = false;

      // Update sprite scale with actual text dimensions
      this.sprite.scale.set(textWidth * this.scale, textHeight * this.scale, 1);
    }

    this.#drawText(label, fontStyle, textWidth, textHeight);
    this.sprite.material.map.needsUpdate = true;
    this.label = label;
  }

  #drawText(label, fontStyle, textWidth, textHeight) {
    this.ctx.font = fontStyle; //this line is required here
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = this.font.color;
    const x = textWidth * 0.1;
    const y = textHeight * 0.15; // due to accents, we need to add some extra space
    if (this.font.strokeColor) {
      this.ctx.strokeStyle = this.font.strokeColor;
      this.ctx.lineWidth = this.font.size / 6;
      this.ctx.strokeText(label, x, y);
    }
    this.ctx.fillText(label, x, y);
  }

  setColor(color) {
    this.font.color = color;
    this.update(this.label);
  }

  setStrokeColor(strokeColor) {
    this.font.strokeColor = strokeColor;
    this.update(this.label);
  }

}

export { TextSprite };
