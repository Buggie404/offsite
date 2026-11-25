/**
 * Rewind an allocation counter after deleting an unpublished release.
 * The compare-and-set keeps a concurrent draft creation from being overwritten.
 */
async function rewindCounterToLatest(counterModel, counterId, releaseModel) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const latest = await releaseModel.findOne().sort({ version: -1 }).select('version').lean();
    if (!latest?.version) return;

    await counterModel.updateOne(
      { _id: counterId },
      { $setOnInsert: { value: latest.version } },
      { upsert: true }
    );

    const counter = await counterModel.findById(counterId).lean();
    if (!counter || counter.value <= latest.version) return;

    const result = await counterModel.updateOne(
      { _id: counterId, value: counter.value },
      { $set: { value: latest.version } }
    );
    if (result.modifiedCount === 1) return;
  }
}

module.exports = { rewindCounterToLatest };
