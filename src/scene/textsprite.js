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
    this.canvas.width = Math.ceil(this.ctx.measureText(label).width);
    this.canvas.height = this.font.size;
    this.#drawText(label, fontStyle);

    const spriteMap = new THREE.CanvasTexture(this.canvas);
    spriteMap.colorSpace = THREE.SRGBColorSpace;
    spriteMap.minFilter = THREE.LinearFilter;
    spriteMap.generateMipmaps = false;
    spriteMap.needsUpdate = true;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: spriteMap, toneMapped: false }));
    sprite.scale.set(scale * this.canvas.width, scale * this.canvas.height, 1);
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

    if (label.length > this.label.length) {
      this.ctx.font = fontStyle;
      this.canvas.width = Math.ceil(this.ctx.measureText(label).width);
      this.canvas.style.width = this.canvas.width + 'px';
    }

    this.#drawText(label, fontStyle);

    if (label.length > this.label.length) {
      this.sprite.material.map.dispose();
      this.sprite.material.map = new THREE.CanvasTexture(this.canvas);
      this.sprite.scale.set(this.scale * this.canvas.width, this.scale * this.canvas.height, 1);
    }
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
