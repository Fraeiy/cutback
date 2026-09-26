export const demoServices = {
  after(delay: number, action: () => void) {
    return window.setTimeout(action, delay)
  },
}
