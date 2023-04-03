import { MutableRefObject, useEffect } from 'react';

const config: MutationObserverInit = {
  attributes: true,
  characterData: true,
  childList: true,
  subtree: true,
};

export function useMutationObserver(
  element: HTMLElement,
  callback: MutationCallback,
  options: MutationObserverInit = config
): void {
  useEffect(() => {
    // Create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    // Start observing the target node for configured mutations
    observer.observe(element, options);

    return () => {
      observer.disconnect();
    };
  }, [callback, element, options]);
}
