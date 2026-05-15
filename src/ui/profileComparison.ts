export type ComparableRelatedNote = {
  path: string;
  title: string;
  score: number;
};

export type ComparedRelatedNote = {
  path: string;
  title: string;
  leftScore: number;
  rightScore: number;
  scoreDelta: number;
  leftRank: number;
  rightRank: number;
  rankDelta: number;
};

export type ProfileComparison = {
  both: ComparedRelatedNote[];
  leftOnly: ComparableRelatedNote[];
  rightOnly: ComparableRelatedNote[];
  rankChanged: ComparedRelatedNote[];
};

export function compareProfileResults(
  left: ComparableRelatedNote[],
  right: ComparableRelatedNote[],
  rankChangeThreshold = 2,
): ProfileComparison {
  const leftByPath = new Map(left.map((note, index) => [note.path, { note, rank: index + 1 }]));
  const rightByPath = new Map(right.map((note, index) => [note.path, { note, rank: index + 1 }]));
  const both: ComparedRelatedNote[] = [];
  const leftOnly: ComparableRelatedNote[] = [];
  const rightOnly: ComparableRelatedNote[] = [];

  for (const [path, leftItem] of leftByPath) {
    const rightItem = rightByPath.get(path);
    if (!rightItem) {
      leftOnly.push(leftItem.note);
      continue;
    }
    both.push({
      path,
      title: leftItem.note.title || rightItem.note.title,
      leftScore: leftItem.note.score,
      rightScore: rightItem.note.score,
      scoreDelta: roundDelta(rightItem.note.score - leftItem.note.score),
      leftRank: leftItem.rank,
      rightRank: rightItem.rank,
      rankDelta: rightItem.rank - leftItem.rank,
    });
  }

  for (const [path, rightItem] of rightByPath) {
    if (!leftByPath.has(path)) rightOnly.push(rightItem.note);
  }

  both.sort((a, b) => Math.min(a.leftRank, a.rightRank) - Math.min(b.leftRank, b.rightRank));

  return {
    both,
    leftOnly,
    rightOnly,
    rankChanged: both.filter((item) => Math.abs(item.rankDelta) >= rankChangeThreshold),
  };
}

function roundDelta(value: number): number {
  return Math.round(value * 100) / 100;
}
