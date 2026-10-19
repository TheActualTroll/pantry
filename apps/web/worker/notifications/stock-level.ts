import {
  DomainError,
  planStockLevelChange,
  type HouseholdStore,
  type InventoryStore,
  type NotificationStore,
  type ProductStore,
  type ShoppingStore,
  type StockLevel,
} from '@pantry/core'

export type StockLevelDeps = {
  households: HouseholdStore
  inventory: InventoryStore
  notifications: NotificationStore
  products: ProductStore
  shopping: ShoppingStore
}

export type StockLevelResult = {
  level: StockLevel
  totalQuantity: number
  addedToShopping: boolean
}

/**
 * Applies a "none / half / all" answer for a household item: adjusts the real
 * stock (FEFO consume or top-up) and, when nothing is left, queues a
 * re-purchase on the shopping list.
 */
export async function applyStockLevel(
  deps: StockLevelDeps,
  input: { householdId: string; userId: string; productId: string; level: StockLevel; now?: Date },
): Promise<StockLevelResult> {
  const product = await deps.products.getReadableProduct({
    householdId: input.householdId,
    productId: input.productId,
  })
  if (!product) {
    throw new DomainError('NOT_FOUND', 'Not found')
  }

  const kind = await deps.notifications.getProductKind({
    householdId: input.householdId,
    productId: input.productId,
  })
  if (kind !== 'household') {
    // Stock levels are only meaningful for household goods, not food.
    throw new DomainError('INVALID_PRODUCT_KIND', 'Stock levels apply to household items only')
  }

  const lots = await deps.inventory.readLotsForConsumption({
    householdId: input.householdId,
    productId: input.productId,
  })
  const total = lots.reduce((sum, lot) => sum + lot.quantity, 0)
  const fullQuantity = await deps.notifications.getFullQuantity({
    householdId: input.householdId,
    productId: input.productId,
  })

  const plan = planStockLevelChange({
    level: input.level,
    totalQuantity: total,
    fullQuantity,
    unit: product.unit,
  })

  let resultingTotal = total
  if (plan.action === 'consume') {
    await deps.inventory.consume({
      householdId: input.householdId,
      userId: input.userId,
      productId: input.productId,
      quantity: plan.quantity,
    })
    resultingTotal = Math.max(0, total - plan.quantity)
  } else if (plan.action === 'add') {
    const biggest = [...lots].sort((left, right) => right.quantity - left.quantity)[0]
    const locationId =
      biggest?.locationId ?? (await deps.households.listActiveLocations(input.householdId))[0]?.id
    if (!locationId) {
      throw new DomainError('NOT_FOUND', 'Not found')
    }
    await deps.inventory.addStock({
      householdId: input.householdId,
      userId: input.userId,
      productId: input.productId,
      locationId,
      quantity: plan.quantity,
      expiresOn: null,
    })
    resultingTotal = total + plan.quantity
  }

  await deps.notifications.recordStockLevel({
    householdId: input.householdId,
    productId: input.productId,
    level: input.level,
    fullQuantity: plan.newFullQuantity,
    now: input.now ?? new Date(),
  })

  let addedToShopping = false
  if (input.level === 'none') {
    try {
      await deps.shopping.addProductItem({
        householdId: input.householdId,
        userId: input.userId,
        productId: input.productId,
        quantity: plan.newFullQuantity ?? 1,
        unit: product.unit,
      })
      addedToShopping = true
    } catch {
      // Already listed with another unit, or similar: the stock answer still stands.
    }
  }

  return { level: input.level, totalQuantity: resultingTotal, addedToShopping }
}
