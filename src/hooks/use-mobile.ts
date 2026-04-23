import * as React from 'react'

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
        : null
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    if (mql && typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
    } else if (mql && typeof mql.addListener === 'function') {
      mql.addListener(onChange)
    }

    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => {
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', onChange)
      } else if (mql && typeof mql.removeListener === 'function') {
        mql.removeListener(onChange)
      }
    }
  }, [])

  return !!isMobile
}
