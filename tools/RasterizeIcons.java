import com.github.weisj.jsvg.parser.SVGLoader;
import com.github.weisj.jsvg.view.ViewBox;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.nio.file.*;
import javax.imageio.ImageIO;

/** Maintainer tool: requires JSVG 2.1.0 on the classpath, available in Archi 5.10/plugins.
 * java -cp "<jsvg.jar>" tools/RasterizeIcons.java <unpacked Icons> <assets/icons>
 * Preserves aspect ratio using SVG viewBox rendering; does not edit the original designs.
 */
public class RasterizeIcons {
    public static void main(String[] args) throws Exception {
        Path source = Path.of(args[0]), target = Path.of(args[1]);
        int count = 0;
        try (var files = Files.walk(source)) {
            for (Path file : files.filter(p -> p.toString().endsWith(".svg")).sorted().toList()) {
                var document = new SVGLoader().load(file.toUri().toURL());
                if (document == null) throw new IllegalStateException("Cannot read SVG: " + file);
                var size = document.size();
                double scale = 96.0 / Math.max(size.width, size.height);
                int width = Math.max(1, (int)Math.round(size.width * scale));
                int height = Math.max(1, (int)Math.round(size.height * scale));
                var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_ARGB);
                var graphics = image.createGraphics();
                graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
                document.render(null, graphics, new ViewBox(0, 0, width, height));
                graphics.dispose();
                Path output = target.resolve(source.relativize(file).toString().replaceAll("\\.svg$", ".png"));
                Files.createDirectories(output.getParent());
                ImageIO.write(image, "png", output.toFile());
                count++;
            }
        }
        System.out.println("Rendered " + count + " Azure icons.");
    }
}
