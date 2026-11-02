import 'package:flutter/material.dart';

/// 新闻/内容流页面（fixture：可滚动屏幕示例）。
class FeedPage extends StatefulWidget {
  const FeedPage({super.key});

  @override
  State<FeedPage> createState() => _FeedPageState();
}

class _FeedPageState extends State<FeedPage> {
  final List<int> _items = List.generate(30, (i) => i);

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Feed')),
      body: ListView.builder(
        itemCount: _items.length,
        itemBuilder: (context, index) => ListTile(title: Text('Item $index')),
      ),
    );
  }
}
