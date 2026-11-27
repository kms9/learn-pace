import type { QuickCheckRequest } from "../../packages/runtime/src/index.js";

const samples = [
  {
    name: "等值分数与约分",
    history: [
      { role: "user", content: "为什么 4/8 和 1/2 表示同样的部分？" },
      { role: "assistant", content: "约分时同时将分子分母除以同一个非零公因数，分数值不变。" },
      { role: "user", content: "既约分数还有公因数吗？" },
      { role: "assistant", content: "最简分数的分子与分母最大公因数是 1，可用新数字练习判断。" },
    ],
  },
  {
    name: "缓存命中与回源",
    history: [
      { role: "user", content: "服务读取缓存时，什么叫命中？" },
      { role: "assistant", content: "有未过期的对应条目就是命中，服务可以直接返回缓存中的值。" },
      { role: "user", content: "如果没有对应条目，服务还会直接返回吗？" },
      { role: "assistant", content: "缓存未命中通常会访问源数据库获取值，然后按策略写入缓存。" },
    ],
  },
  {
    name: "因果与混杂变量",
    history: [
      { role: "user", content: "为什么相关性不一定表示因果关系？" },
      { role: "assistant", content: "两个变量可能同时受第三个因素影响，也可能存在反向因果。" },
      { role: "user", content: "夏天冰淇淋销售与中暑呈正相关，怎么分析？" },
      { role: "assistant", content: "高温可能同时增加两者。研究因果关系时，应考虑控制第三个因素。" },
    ],
  },
  {
    name: "TCP 与 UDP",
    focusExcerpt: "TCP 保证有序可靠传输，UDP 的报文开销小，应用可自行决定是否重传。",
    history: [
      { role: "user", content: "TCP 与 UDP 的主要差别是什么？" },
      { role: "assistant", content: "TCP 保证有序可靠传输，UDP 的报文开销小，应用可自行决定是否重传。" },
      { role: "user", content: "实时游戏偶尔丢数据怎么办？" },
      { role: "assistant", content: "实时状态常可用下一条增量直接替换过时状态，不用等每条状态被重传。" },
    ],
  },
  {
    name: "数据结构选型",
    history: [
      { role: "user", content: "为什么常用队列处理先来先服务的任务？" },
      { role: "assistant", content: "队列采用先进先出。栈采用后进先出，适合回退最近的操作。" },
      { role: "user", content: "通知任务有优先级又不允许打断正在执行的任务呢？" },
      { role: "assistant", content: "可以给等待任务按优先级排队。正在执行的任务完成后，再选最高优先级的等待任务。" },
    ],
  },
  {
    name: "三角形面积",
    history: [
      { role: "user", content: "三角形面积怎么算？" },
      { role: "assistant", content: "同底等高的两个相同三角形可拼成平行四边形，所以三角形面积为底乘高除以二。" },
      { role: "user", content: "平行四边形的斜边长度能当高吗？" },
      { role: "assistant", content: "高要沿垂直于底的方向测量。斜边一般不等于高。" },
    ],
  },
  {
    name: "英语可数与不可数名词",
    history: [
      { role: "user", content: "When do I use fewer instead of less?" },
      { role: "assistant", content: "Use fewer with plural countable nouns such as books, and less with uncountable quantities such as water." },
      { role: "user", content: "Do two types of bread mean I should change the rule?" },
      { role: "assistant", content: "You can count the types or loaves. Bread as a substance is still uncountable." },
    ],
  },
  {
    name: "数据库事务原子性",
    focusExcerpt: "一项事务中的多次写入要么一起提交，要么一起回滚。",
    history: [
      { role: "user", content: "数据库事务的原子性怎么理解？" },
      { role: "assistant", content: "一项事务中的多次写入要么一起提交，要么一起回滚。" },
      { role: "user", content: "那转账中扣款成功、收款入账报错会怎样？" },
      { role: "assistant", content: "如果两次写入属于同一个原子事务，入账失败会让此前的扣款一起回滚。" },
    ],
  },
  {
    name: "二分查找与时间复杂度",
    history: [
      { role: "user", content: "为什么二分查找比逐项找快？" },
      { role: "assistant", content: "在有序数组里比较中间项可排除一半候选项，所需轮数随数组长度对数增长。" },
      { role: "user", content: "能把这个方法直接用到没排序的数组上吗？" },
      { role: "assistant", content: "不能直接用。一半能被排除依赖数组有序，否则被排除的区间可能包含目标。" },
    ],
  },
  {
    name: "欧姆定律与串联",
    history: [
      { role: "user", content: "欧姆定律里电流、电压和电阻如何关联？" },
      { role: "assistant", content: "电流等于电压除以电阻。保持电阻不变时，电流和电压成正比。" },
      { role: "user", content: "串联的两只电阻能当成一只计算吗？" },
      { role: "assistant", content: "可以把两只串联电阻的阻值相加，算出总电阻。两只电阻通过同一电流。" },
    ],
  },
] satisfies (Omit<QuickCheckRequest, "signal" | "makeId"> & { name: string })[];

export { samples };
