// Scroll infinito simples: renderiza os itens em lotes e revela mais conforme
// o sentinela entra em vista. Evita montar centenas de linhas de uma só vez e
// mantém a página curta na vertical (o scroll fica dentro do painel).

import { useEffect, useRef, useState, type RefObject } from 'react'

export interface Incremental<T> {
  /** Fatia atualmente visível da lista. */
  visible: T[]
  /** Ref para o elemento sentinela colocado no fim da lista. */
  sentinelRef: RefObject<HTMLDivElement | null>
  /** true enquanto ainda há itens não revelados. */
  hasMore: boolean
}

/**
 * Revela `items` progressivamente em lotes de `step`.
 * O contador reinicia sempre que a referência de `items` muda (ex.: ao trocar
 * filtro/ordenação), voltando ao topo do lote.
 */
export function useIncremental<T>(items: T[], step = 40): Incremental<T> {
  const [count, setCount] = useState(step)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Reinicia quando a lista (referência) muda.
  useEffect(() => {
    setCount(step)
  }, [items, step])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setCount((c) => Math.min(c + step, items.length))
        }
      },
      { rootMargin: '250px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [items.length, step])

  const visible = count >= items.length ? items : items.slice(0, count)
  return { visible, sentinelRef, hasMore: count < items.length }
}
