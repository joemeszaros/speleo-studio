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
    const devicePixelRatio = 1; //window.devicePixelRatio || 1;
    const fontStyle = `${this.font.size}px ${this.font.family}`;
    this.ctx.font = fontStyle;

    const textMetrics = this.ctx.measureText(label);
    const textWidth = Math.ceil(textMetrics.width);
    const textHeight = this.font.size;

    this.canvas.width = textWidth * devicePixelRatio;
    this.canvas.height = textHeight * devicePixelRatio;
    this.canvas.style.width = textWidth + 'px';
    this.canvas.style.height = textHeight + 'px';

    this.ctx.scale(devicePixelRatio, devicePixelRatio);

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
