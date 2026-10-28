public class Idle {
  public static int intValue = 42;
  public static boolean boolValue = true;
  public static double doubleValue = 3.14;
  public static String utf8Value = "Hello from njava";
  public static String utf16Value = "njava buradaydı 🐛";
  public static Idle instance = null;

  public String name;
  public int score;

  public Idle() {
    this.name = "defaultPlayer";
    this.score = 100;
  }

  public Idle(String name, int score) {
    this.name = name;
    this.score = score;
  }

  public static int add(int a, int b) {
    return a + b;
  }

  public static Idle create(String name, int score) {
    return new Idle(name, score);
  }

  public String greet(String prefix) {
    return prefix + ", " + this.name + "!";
  }

  public int increaseScore(int delta) {
    this.score += delta;
    return this.score;
  }

  public static void main(String[] a) throws Exception {
    instance = new Idle("serverInstance", 999);
    while (true) Thread.sleep(200);
  }
}
