import * as THREE from 'three';

/**
 * TextSprite class for rendering crisp text labels in 3D space
 *
 * Improvements made:
 * 1. High-DPI support: Uses devicePixelRatio for crisp rendering on retina displays
 * 2. Proper canvas sizing: Separates logical text size from canvas resolution
 * 3. Better texture filtering: Uses LinearFilter for both min and mag filters
 * 4. Efficient updates: Only recreates texture when canvas size changes
 *
 * The scale parameter now works with actual text dimensions instead of canvas dimensions,
 * eliminating the need for arbitrary scale factors to combat blurriness.
 */
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
    // Calculate device pixel ratio for crisp rendering on high-DPI displays
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Set up canvas with proper dimensions
    const fontStyle = `${this.font.size}px ${this.font.family}`;
    this.ctx.font = fontStyle;

    // Calculate text dimensions
    const textMetrics = this.ctx.measureText(label);
    const textWidth = Math.ceil(textMetrics.width);
    const textHeight = this.font.size;

    // Set canvas size with device pixel ratio for crisp rendering
    this.canvas.width = textWidth * devicePixelRatio;
    this.canvas.height = textHeight * devicePixelRatio;

    // Set display size (CSS size)
    this.canvas.style.width = textWidth + 'px';
    this.canvas.style.height = textHeight + 'px';

    // Scale the context to match device pixel ratio
    this.ctx.scale(devicePixelRatio, devicePixelRatio);

    // Draw the text
    this.#drawText(label, fontStyle);

    const spriteMap = new THREE.CanvasTexture(this.canvas);
    spriteMap.colorSpace = THREE.SRGBColorSpace;
    spriteMap.minFilter = THREE.LinearFilter;
    spriteMap.magFilter = THREE.LinearFilter;
    spriteMap.generateMipmaps = false;
    spriteMap.needsUpdate = true;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap, toneMapped: false }));
    // Use actual text dimensions for scaling, not canvas dimensions
    sprite.scale.set(scale * textWidth, scale * textHeight, 1);
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
    const devicePixelRatio = window.devicePixelRatio || 1;
    const currentCanvasWidth = this.canvas.width / devicePixelRatio;
    const currentCanvasHeight = this.canvas.height / devicePixelRatio;

    if (textWidth > currentCanvasWidth || textHeight > currentCanvasHeight) {
      // Resize canvas with device pixel ratio
      this.canvas.width = textWidth * devicePixelRatio;
      this.canvas.height = textHeight * devicePixelRatio;

      // Set display size (CSS size)
      this.canvas.style.width = textWidth + 'px';
      this.canvas.style.height = textHeight + 'px';

      // Scale the context to match device pixel ratio
      this.ctx.scale(devicePixelRatio, devicePixelRatio);

      // Recreate texture with new canvas
      this.sprite.material.map.dispose();
      this.sprite.material.map = new THREE.CanvasTexture(this.canvas);
      this.sprite.material.map.colorSpace = THREE.SRGBColorSpace;
      this.sprite.material.map.minFilter = THREE.LinearFilter;
      this.sprite.material.map.magFilter = THREE.LinearFilter;
      this.sprite.material.map.generateMipmaps = false;

      // Update sprite scale with actual text dimensions
      this.sprite.scale.set(this.scale * textWidth, this.scale * textHeight, 1);
    }

    this.#drawText(label, fontStyle);
    this.sprite.material.map.needsUpdate = true;
    this.label = label;
  }

  #drawText(label, fontStyle) {
    this.ctx.font = fontStyle; //this line is required here
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillStyle = this.font.color;

    if (this.font.strokeColor) {
      this.ctx.strokeStyle = this.font.strokeColor;
      this.ctx.lineWidth = this.font.size / 6;
      this.ctx.strokeText(label, 0, 0);
    }
    this.ctx.fillText(label, 0, 0);
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
