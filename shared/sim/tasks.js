// Сопрограммы на генераторах — как корутины Unity. Внутри генератора:
//   yield            — подождать до следующего такта;
//   yield 1.5        — подождать 1.5 секунды;
//   yield* other()   — выполнить другую сопрограмму и дождаться её конца.

export class Tasks {
  constructor(clock) {
    this.clock = clock;
    this.list = [];
  }

  start(generator) {
    const task = { generator, resumeAt: 0, done: false };
    this.list.push(task);
    return task;
  }

  stopAll() {
    for (const task of this.list) task.done = true;
    this.list = [];
  }

  update() {
    const now = this.clock.now;
    for (const task of [...this.list]) {
      if (task.done || now < task.resumeAt) continue;
      const result = task.generator.next();
      if (result.done) task.done = true;
      else task.resumeAt = typeof result.value === 'number' ? now + result.value : 0;
    }
    this.list = this.list.filter((t) => !t.done);
  }
}
