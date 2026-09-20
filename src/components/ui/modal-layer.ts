/** Tracks mounted modals so only the topmost handles Escape / focus trap. */
const stack: symbol[] = [];

export function registerModalLayer(id: symbol) {
  stack.push(id);
  return () => {
    const index = stack.lastIndexOf(id);
    if (index >= 0) stack.splice(index, 1);
  };
}

export function isTopModalLayer(id: symbol) {
  return stack.length > 0 && stack[stack.length - 1] === id;
}
