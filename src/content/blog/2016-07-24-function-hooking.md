---
author: Nick Guletskii
pubDatetime: 2016-07-24T13:44:20Z
title: Creating shared libraries for function hooking on Linux (lessons learned from building an OSD for OpenGL applications)
postSlug: 2016-07-24-function-hooking
legacyLinks:
  - "2016/7/24/function-hooking"
featured: false
tags:
  - c
  - linux
description: This is a guide, or rather, a list of things that I wish I had when creating GLXOSD, an OSD for OpenGL applications on Linux. There are many non-obvious problems that can arise while writing shared libraries meant for hooking API calls in various applications.
---

## Introduction

To start out, I would like to say that this is a guide, or rather, a list of things that I wish I had when creating GLXOSD, an OSD for OpenGL applications on Linux. There are many non-obvious problems that can arise while writing shared libraries meant for hooking API calls in various applications.

Please note that the information contained in this post mainly applies to GNU systems - while you may be able to apply the general tips to other systems, there are some tricks described that are only available with GNU binutils and GCC.

### LD\_PRELOAD and its applications

LD\_PRELOAD is an environmental variable that allows us to load a set of shared libraries before any other shared libraries or executables are loaded by the dynamic linker. For more information, please see [man ld.so](http://linux.die.net/man/8/ld.so).

The main use for LD\_PRELOAD nowadays is to hook some API calls to extend their functionality in one way or another. For instance, GLXOSD and Steam both use LD\_PRELOAD and a shared library to hook various GLX and X11 calls to show an overlay in games. There are also systems like Bumblebee, which replace OpenGL implementations to provide switchable graphics. This post describes what must be done to create a shared library that can be LD\_PRELOADed into almost arbitrary applications, much like the Steam overlay.

By the way, I will refer to the program into which we are preloading our libraries as the "host application".

##  Hooking into API calls

To begin, we must first determine what functions we want to hook and how the host application and its dependencies may obtain access to them. In most cases, the dynamic linker automatically resolves the required symbols from binaries available in  LD\_PRELOAD and LD\_LIBRARY\_PATH. In this case we just need to declare a function with the same signature as the function we are trying to override (I will call functions that we are overriding real from now on). However, the application may obtain the functions using functions that return function pointers, such as [`dlsym`](http://linux.die.net/man/3/dlsym), [`dlvsym`](http://linux.die.net/man/3/dlvsym) or others (e.g. [`glXGetProcAddress`](https://www.opengl.org/sdk/docs/man2/xhtml/glXGetProcAddress.xml) for GLX applications). To make sure that our function is used instead of the real function, we must override these function pointer-returning functions and add the logic to return pointers to our functions instead.

To implement hooking, we must also somehow retrieve the host application's real version of the function we are overriding (after all, we want to delegate the main logic to the real functions). While it may seem like calling `dlsym` is the natural solution, there is a big caveat: we are overriding `dlsym` too, and if we don't have the real `dlsym`, how can we load it? Fortunately, there is a library that can help us with that. It is called [elfhacks](https://github.com/nullkey/elfhacks) and it's quite simple to use.

Here is an example of how to retrieve the real `dlsym` and `dlvsym` from libdl:

```c
typedef (void*) (*dlsym_type) (const void *, const char *);
dlsym_type our_real_dlsym;
typedef (void*) (*dlvsym_type) (const void *, const char *, const char *);
dlvsym_type our_real_dlvsym;

eh_obj_t libdl;
if (eh_find_obj(&libdl, "*/libdl.so*")) {
  fprintf(stderr, "Couldn't find libdl!\n");
  exit(EXIT_FAILURE);
}
if (eh_find_sym(&libdl, "dlsym", (void **) &our_real_dlsym)) {
  fprintf(stderr, "Couldn't find dlsym in libdl!\n");
  eh_destroy_obj(&libdl);
  exit(EXIT_FAILURE);
}
if (eh_find_sym(&libdl, "dlvsym", (void **) &our_real_dlvsym)) {
  fprintf(stderr, "Couldn't find dlvsym in libdl!\n");
  eh_destroy_obj(&libdl);
  exit(EXIT_FAILURE);
}
eh_destroy_obj(&libdl);
```

After we have retrieved the real `dlsym`, we can just call it through `our_real_dlsym`. Thus, loading further functions should be as easy as passing a library handle (or `RTLD_NEXT`) and the name of the function to the real `dlsym`.

## General tips for creating LD\_PRELOADable libraries

So, with the general steps being out of the way, let's get to the tips and pitfalls:

* Minimise the amount of exported symbols by using version scripts to hide symbols.

  To do that, you should create a version script with contents similar to the following and pass it to the linker using the `--version-script` flag [(man page)](https://www.gnu.org/software/gnulib/manual/html_node/LD-Version-Scripts.html) :

``` c
{
  global:
    dlsym;
    dlvsym;
    ...
    Other symbols that you want to export
    ...
  local: *;
};
```

  If you are using CMake, you can attach a version script to a target using [`set_target_properties`](https://cmake.org/cmake/help/v3.5/command/set_target_properties.html) (substitute `@TARGET@` with your target):

``` cmake
set_target_properties(@TARGET@ PROPERTIES LINK_FLAGS "-Wl,--version-script=${PATH_TO_VERSION_SCRIPT}")
```

* Minimise the amount of dynamically linked dependencies. That means that you should statically link all dependencies and hide the linked symbols using linker version scripts. This may take some effort, especially when a library you are using does not have the build scripts for the build system of your choice. The reasoning behind this is that you'll get crashes if the host application ships with a different version of the same library, or there is an unintended overlap between the host application's symbols and the symbols you introduce through LD\_PRELOAD (which includes any symbols that are exported from the shared library you are linked to, or any shared library you load using `dlopen`[(man page)](http://linux.die.net/man/3/dlopen)).  

Unfortunately, at least in my case, this implied abandoning C++ since I couldn't find a way to properly statically link libstdc++. You may have better luck, but I chose to use LuaJIT for high-level logic instead - it significantly sped up the development of GLXOSD and made it much easier to debug integration issues with multiarch applications, since before I started using [LuaJIT](http://luajit.org/) I had to recompile the whole project in a chroot even for the tiniest of changes. However, even if you find a way to link libstdc++ properly, you should be aware of the fact that some functionality from the STL doesn't work before the application enters the `main` method, which further complicates things.

##  A checklist for debugging segfaults in shared libraries

Here is a checklist I wish I had when I was debugging GLXOSD. This checklist includes a couple of causes of segmentation faults related to dynamic linking that are not so obvious at first.

1. Ensure that there are no standard causes for segfaults, like dereferencing a pointer to memory you do not own (stepping out of array bounds, dereferencing a null pointer, accessing freed memory). If your program crashes in a seemingly random place, the stack gets corrupted, there is no backtrace, or something else looks fishy, continue down the list.

2. I know that this kind of falls within the first point, but if you are dynamically loading symbols (using `dlsym` or similar), make sure that your function pointers aren't null when you invoke them.

3. Check that the symbols you export don't replace symbols from the executable and/or its accompanying libraries without delegating the logic to the underlying implementation, i.e. your symbols should call the library in which they are normally declared unless you are knowingly replacing the library completely.

  This goes hand-in-hand with minimising the amount of dynamically linked dependencies. I am repeating myself here, but this is very important because different versions and implementations of an API may have different guarantees and the host application may rely on these guarantees. And once you've linked everything statically, you should remember to hide the symbols using a version script (as previously mentioned).

  I initially made the mistake of linking libraries dynamically while working on GLXOSD. I thought that using `dlopen` wouldn't expose the loaded symbols to other binaries, so I loaded shared libraries with `dlopen` and retrieved the symbols I needed using `dlsym`. Only after carefully scouring through the output of LD\_DEBUG (more on that later) did I find the cause of my misfortunes: the LuaJIT shared library I was loading using `dlopen` overrode the liblua symbols in the host application. After statically linking LuaJIT and other shared libraries, as well as hiding the linked symbols using a linker version script, the problems disappeared.

## Debugging problems with linking and symbol overlaps

There are quite a few tools that can help you shed some light on what the problem is.

1. `ldd [path to binary]` will list the shared libraries the binary depends upon. [(man page)](http://linux.die.net/man/1/ldd) 
2. `nm -D [path to binary]` will list the symbols exported from the binary. You can use this to check that your binaries only export the symbols you are consciously overriding. [(man page)](http://linux.die.net/man/1/nm) 
3. `LD_DEBUG=all LD_DEBUG_OUTPUT=[path to log] [executable]` [(man page)](http://man7.org/linux/man-pages/man8/ld.so.8.html#ENVIRONMENT)  will run the executable and print all dynamic linker debug information to a file.  You can use this to check from which binary a symbol is being pulled. For example, you may find something like this in the generated log file:

        symbol=malloc;  lookup in file=someexecutable [0]
        symbol=malloc;  lookup in file=/lib/x86_64-linux-gnu/libfoo.so.1 [0]
        symbol=malloc;  lookup in file=/lib/x86_64-linux-gnu/libc.so.6 [0]
        binding file someexecutable [0] to /lib/x86_64-linux-gnu/libc.so.6 [0]: normal symbol `malloc' [GLIBC_2.99.99]

    This indicates that `malloc` was requested by `someexecutable` and the dynamic linker gave it the `malloc` it found in libc.

4. You can use GDB to debug your shared library. You just have to set LD\_PRELOAD *inside* GDB, like so: `set environment LD_PRELOAD=/path/to/your/shared/library`

## A quick note on `dlmopen`

There is a GNU-specific function called `dlmopen`, which should, in theory, allow you to load shared libraries into a different "namespace", effectively allowing you to load whatever shared libraries you please without allowing the dynamic linker to attempt to bind the host application and its dependencies to symbols from the `dlmopen`ed libraries. Unfortunately, I never got it to work properly - I kept getting segfaults no matter what I tried.

## Summing it up

As you may be able to tell from the problems described, writing such shared libraries is a time consuming and often frustrating task. While the development of GLXOSD was a major waste of time (although, admittedly, I think I wasted more time on packaging it than actually debugging it), I don't regret making it because it has been a great learning experience and it gave me a few ideas that I might express in another post some day.

I hope that someone will find this post useful, and I wish the best of luck to anyone who has to deal with the problems described in this post.