import { afterEach, describe, expect, it } from 'vitest'

import { $studioBalanceVersion, bumpStudioBalance, resetStudioBalanceForTests } from './studio-balance'

afterEach(() => {
  resetStudioBalanceForTests()
})

describe('studio-balance store', () => {
  it('starts at zero', () => {
    expect($studioBalanceVersion.get()).toBe(0)
  })

  it('increments the version on each bump', () => {
    bumpStudioBalance()
    expect($studioBalanceVersion.get()).toBe(1)

    bumpStudioBalance()
    expect($studioBalanceVersion.get()).toBe(2)
  })

  it('resets to zero for tests', () => {
    bumpStudioBalance()
    resetStudioBalanceForTests()
    expect($studioBalanceVersion.get()).toBe(0)
  })
})
