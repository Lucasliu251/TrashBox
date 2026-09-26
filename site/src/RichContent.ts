import { defineComponent, h, type VNodeChild } from 'vue'

const allowed = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'span', 'a', 'img'])

function safeUrl(raw: string | null): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw, window.location.origin)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}

function toVNode(node: Node): VNodeChild {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || ''
  if (!(node instanceof HTMLElement)) return null
  const tag = node.tagName.toLowerCase()
  const children = [...node.childNodes].map(toVNode)
  if (!allowed.has(tag)) return children
  if (tag === 'img') {
    const src = safeUrl(node.getAttribute('src'))
    return src ? h('img', { src, alt: node.getAttribute('alt') || '动态图片', loading: 'lazy' }) : null
  }
  if (tag === 'a') {
    const href = safeUrl(node.getAttribute('href'))
    return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children) : children
  }
  return h(tag, children)
}

export default defineComponent({
  name: 'RichContent',
  props: { html: { type: String, default: '' } },
  setup(props) {
    return () => {
      const document = new DOMParser().parseFromString(props.html, 'text/html')
      return h('div', { class: 'post-body' }, [...document.body.childNodes].map(toVNode))
    }
  },
})
