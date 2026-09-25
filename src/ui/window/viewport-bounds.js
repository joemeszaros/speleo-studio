/*
 * Copyright 2026 Joe Meszaros
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

/**
 * Measures the rectangle that floating windows may occupy: the viewport minus the navbar, the
 * footer and the sidebar.
 *
 * This is the only place allowed to know which elements make up the surrounding UI. The old
 * window manager hard coded navbarHeight = 48 and footerHeight = 30 and sniffed the sidebar's
 * --sidebar-width custom property together with its .collapsed and .left classes; measuring the
 * elements instead means the numbers cannot drift away from the CSS.
 */

const NAVBAR_SELECTOR = '.topnavbar';
const FOOTER_SELECTOR = '#footer';
const SIDEBAR_SELECTOR = '#sidebar-container';

/**
 * @returns {{top: number, bottom: number, left: number, right: number, width: number, height: number}}
 */
function getUsableBounds() {
  const navbar = document.querySelector(NAVBAR_SELECTOR);
  const footer = document.querySelector(FOOTER_SELECTOR);
  const sidebar = document.querySelector(SIDEBAR_SELECTOR);

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const navbarRect = navbar?.getBoundingClientRect();
  const footerRect = footer?.getBoundingClientRect();
  const sidebarRect = sidebar?.getBoundingClientRect();

  const top = navbarRect?.height ? Math.max(0, navbarRect.bottom) : 0;
  const bottom = footerRect?.height ? Math.min(viewportHeight, footerRect.top) : viewportHeight;

  let left = 0;
  let right = viewportWidth;

  if (sidebarRect?.width) {
    // The sidebar lives on whichever side it is closer to; it is a flex sibling of the viewport,
    // so its own rect tells us which without consulting class names.
    if (sidebarRect.left <= viewportWidth - sidebarRect.right) {
      left = Math.min(viewportWidth, sidebarRect.right);
    } else {
      right = Math.max(0, sidebarRect.left);
    }
  }

  return {
    top,
    bottom : Math.max(top, bottom),
    left,
    right  : Math.max(left, right),
    width  : Math.max(0, Math.max(left, right) - left),
    height : Math.max(0, Math.max(top, bottom) - top)
  };
}

export { getUsableBounds };
