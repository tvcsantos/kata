import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import { onMounted, watch, nextTick } from 'vue'
import { useRoute, inBrowser } from 'vitepress'
// @ts-expect-error -- lightbox3 types don't cover the style.css export
import 'lightbox3/style.css'
import { Lightbox } from 'lightbox3'
import CopyOrDownloadAsMarkdownButtons from 'vitepress-plugin-llms/vitepress-components/CopyOrDownloadAsMarkdownButtons.vue'
// @ts-expect-error -- CSS side-effect import handled by Vite
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CopyOrDownloadAsMarkdownButtons', CopyOrDownloadAsMarkdownButtons)
  },
  setup() {
    const route = useRoute()

    const initLightbox = (): void => {
      if (!inBrowser) return

      // Wrap each doc image in a lightbox-enabled anchor
      document.querySelectorAll('.vp-doc img').forEach((img) => {
        const el = img as HTMLImageElement
        // Skip if already wrapped
        if (el.parentElement?.hasAttribute('data-lightbox')) return

        const a = document.createElement('a')
        a.href = el.src
        a.setAttribute('data-lightbox', 'docs')
        a.setAttribute('data-caption', el.alt || '')
        el.parentElement?.insertBefore(a, el)
        a.appendChild(el)
      })

      Lightbox.init()
    }

    onMounted(initLightbox)
    watch(
      () => route.path,
      () => nextTick(initLightbox)
    )
  }
} satisfies Theme
