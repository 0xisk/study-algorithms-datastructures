import { LevelUp } from 'levelup'

export async function saveTree(db: LevelUp, tree: Buffer[][]): Promise<void> {
  const serializedTree = tree.map(layer => layer.map(element => element.toString('base64')))

  const jsonTree = JSON.stringify(serializedTree)

  await db.put(Buffer.from('tree'), Buffer.from(jsonTree))
}

export async function getTree(db: LevelUp): Promise<Buffer[][] | undefined> {
  try {
    const jsonTree = await db.get(Buffer.from('tree'))

    // Ensure that the retrieved value is not empty or undefined
    if (!jsonTree || jsonTree.length === 0 || jsonTree === undefined) {
      console.warn('Tree not found or empty, returning undefined')
      return undefined
    }

    const serializedTree: string[][] = JSON.parse(jsonTree.toString())

    return serializedTree.map(layer => layer.map(element => Buffer.from(element, 'base64')))
  } catch (error) {
    console.error('Error retrieving tree from the database:', error)
    throw error
  }
}
