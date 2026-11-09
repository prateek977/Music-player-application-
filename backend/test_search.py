from pytubefix import Search
s = Search("Drake")
print("Found", len(s.videos))
print(s.videos[0].title)
