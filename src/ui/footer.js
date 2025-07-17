import { node } from '../utils/utils.js';

class Footer {

  constructor(element) {
    this.messagesContainer = node`<div class="content"><div/>`;
    element.appendChild(document.createTextNode('Speleo Studio 1.0.0'));
    element.appendChild(this.messagesContainer);
    this.message = undefined;
  }

  showMessage(message) {
    this.messagesContainer.innerHTML = message;
  }

  clearMessage() {
    this.messagesContainer.innerHTML = '';
  }
}

export { Footer };
