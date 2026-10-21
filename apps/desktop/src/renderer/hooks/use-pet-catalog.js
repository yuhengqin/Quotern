import { useCallback, useEffect, useState } from 'react';

const builtins = [
  { id: 'clawd', displayName: 'Clawd', spriteVersionNumber: 1 },
  { id: 'bot', displayName: 'Bot', spriteVersionNumber: 1 },
];

export function usePetCatalog() {
  const [pets, setPets] = useState(() => window.__quoternPetCatalog || builtins);
  const refresh = useCallback(() => {
    setPets(window.__quoternPetCatalog || builtins);
  }, []);
  useEffect(() => {
    window.addEventListener('pet:catalog', refresh);
    return () => window.removeEventListener('pet:catalog', refresh);
  }, [refresh]);
  return { pets, refresh };
}
